// scripts/collect-genius-sampling.ts
/**
 * Genius API から、曲どうしの関係(サンプリング・インターポレーション・リミックス)を集めて track_relation に入れる。
 *   カタログの曲 → Geniusで「アーティスト名 曲名」を検索し、曲名・アーティスト名が正規化して完全一致するヒットだけ採用 →
 *   /songs/{id} の song_relationships(samples / sampled_in / interpolates / interpolated_by / remix_of / remixed_by)を読む →
 *   相手の曲がカタログと完全一致して1つに決まれば曲どうしを結ぶ。カタログに無い元ネタは、名前だけを残す。
 * 対象の順: キュレーション・アワード・フェスに載るアーティストから。1アーティストにつき、アルバムの前のほうの曲(最大25曲)。
 * Genius のトークンは環境変数 GENIUS_ACCESS_TOKEN(.env.local)。1秒に1件ほどの速さで呼ぶ。再開できる(/private/tmp/genius-state.json)。
 * LLM・iTunesは使わない。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/collect-genius-sampling.ts [--max-minutes=N] [--limit-artists=N] [--per-artist=25] [--dry-run]
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { createAdminClient } from '@/utils/Supabase/admin'

const TOKEN = process.env.GENIUS_ACCESS_TOKEN
const STATE = '/private/tmp/genius-state.json'
const MAX_MIN = Number(process.argv.find((a) => a.startsWith('--max-minutes='))?.split('=')[1] ?? 0)
const LIMIT_ARTISTS = Number(process.argv.find((a) => a.startsWith('--limit-artists='))?.split('=')[1] ?? 0)
const PER_ARTIST = Number(process.argv.find((a) => a.startsWith('--per-artist='))?.split('=')[1] ?? 25)
const DRY = process.argv.includes('--dry-run')
const GAP_MS = 1000

type State = { artistsDone: string[]; tracksDone: Record<string, string> }
const state: State = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { artistsDone: [], tracksDone: {} }
const save = () => {
  if (!DRY) writeFileSync(STATE, JSON.stringify(state))
}

const norm = (s: string) =>
  s.normalize('NFKC').toLowerCase().replace(/\s*[(\[（][^)\]）]*(feat\.?|ft\.?|featuring|with)[^)\]）]*[)\]）]/g, '').replace(/[\s'’"“”.,!?・&\-_/()[\]:：〜~☆★♪]/g, '')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let last = 0
async function genius(path: string): Promise<{ status: number; json: any } | null> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const wait = last + GAP_MS - Date.now()
    if (wait > 0) await sleep(wait)
    last = Date.now()
    try {
      const r = await fetch(`https://api.genius.com${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } })
      if (r.status === 429 || r.status >= 500) {
        await sleep(30000 * attempt)
        continue
      }
      return { status: r.status, json: await r.json().catch(() => null) }
    } catch {
      await sleep(5000 * attempt)
    }
  }
  return null
}

type GSong = { id: number; title: string; primary_artist?: { name: string }; full_title?: string }

async function main() {
  if (!TOKEN) throw new Error('GENIUS_ACCESS_TOKEN が .env.local にありません')
  const supabase = createAdminClient()
  const started = Date.now()

  const priority = new Map<string, number>()
  for (const [table, w] of [['ranking_entry', 3], ['award_entry', 3], ['event_appearance_artist', 1]] as const) {
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from(table).select('artist_id').not('artist_id', 'is', null).range(from, from + 999)
      for (const r of data ?? []) priority.set(r.artist_id as string, (priority.get(r.artist_id as string) ?? 0) + w)
      if ((data ?? []).length < 1000) break
    }
  }
  const done = new Set(state.artistsDone)
  const queue = Array.from(priority.keys()).filter((id) => !done.has(id)).sort((a, b) => (priority.get(b) ?? 0) - (priority.get(a) ?? 0))
  console.log(`対象アーティスト ${queue.length}(処理済み ${done.size})`)

  async function findTrack(artistName: string, title: string): Promise<string | null> {
    const { data: arts } = await supabase.from('artist').select('id, name').ilike('name', artistName.replace(/[\\%_]/g, (m) => `\\${m}`)).limit(5)
    const exact = (arts ?? []).filter((a) => norm(a.name as string) === norm(artistName))
    if (exact.length !== 1) return null
    const { data: tr } = await supabase.from('track').select('id, title, album:album_id(release_date)').eq('artist_id', exact[0].id).limit(3000)
    const hits = (tr ?? [])
      .filter((t) => norm(t.title as string) === norm(title))
      .map((t) => ({ id: t.id as string, rel: ((Array.isArray(t.album) ? t.album[0] : t.album) as { release_date?: string } | null)?.release_date ?? '9999' }))
      .sort((a, b) => a.rel.localeCompare(b.rel))
    return hits[0]?.id ?? null
  }
  async function insertRel(row: Record<string, unknown>): Promise<boolean> {
    const { error } = await supabase.from('track_relation').insert(row)
    return !error
  }

  const tally = { artists: 0, tracks: 0, matched: 0, linked: 0, unresolved: 0, noMatch: 0 }
  for (const artistId of queue) {
    if (LIMIT_ARTISTS && tally.artists >= LIMIT_ARTISTS) break
    if (MAX_MIN && (Date.now() - started) / 60000 > MAX_MIN) break
    tally.artists++
    state.artistsDone.push(artistId)
    const { data: artist } = await supabase.from('artist').select('id, name').eq('id', artistId).maybeSingle()
    if (!artist) continue
    // アルバムの前のほうの曲(版・ライブでないもの)
    const { data: tracks } = await supabase
      .from('track')
      .select('id, title, track_no')
      .eq('artist_id', artistId)
      .not('track_no', 'is', null)
      .lte('track_no', 4)
      .order('track_no')
      .limit(PER_ARTIST * 3)
    const picks: { id: string; title: string }[] = []
    const seen = new Set<string>()
    for (const t of tracks ?? []) {
      const title = t.title as string
      if (/(remix|edit|live|instrumental|karaoke|mix\)|ver\.|version)/i.test(title)) continue
      const k = norm(title)
      if (seen.has(k) || state.tracksDone[t.id as string]) continue
      seen.add(k)
      picks.push({ id: t.id as string, title })
      if (picks.length >= PER_ARTIST) break
    }
    for (const t of picks) {
      tally.tracks++
      const s = await genius(`/search?q=${encodeURIComponent(`${artist.name} ${t.title}`)}`)
      if (!s || s.status === 401) throw new Error('Genius: トークンが無効です(401)')
      const hit = ((s.json?.response?.hits ?? []) as { type: string; result: GSong }[])
        .map((h) => h.result)
        .find((r) => norm(r.title) === norm(t.title) && r.primary_artist && norm(r.primary_artist.name) === norm(artist.name as string))
      if (!hit) { state.tracksDone[t.id] = 'no-match'; tally.noMatch++; continue }
      tally.matched++
      const song = await genius(`/songs/${hit.id}?text_format=plain`)
      state.tracksDone[t.id] = 'read'
      const rels = (song?.json?.response?.song?.song_relationships ?? []) as { relationship_type: string; songs: GSong[] }[]
      for (const rel of rels) {
        const type = rel.relationship_type
        if (!['samples', 'sampled_in', 'interpolates', 'interpolated_by', 'remix_of', 'remixed_by'].includes(type) || !rel.songs?.length) continue
        for (const o of rel.songs.slice(0, 12)) {
          if (!o.primary_artist?.name) continue
          const other = await findTrack(o.primary_artist.name, o.title)
          const relType = type.startsWith('remix') ? 'remix' : 'sample'
          const kindNote = type.startsWith('interpol') ? '引用・再演' : type.startsWith('remix') ? 'リミックス' : 'サンプリング'
          const note = `${kindNote}(Genius)`
          // 「この曲が使っている/元になっている」= this → other。「使われている/リミックスされている」= other → this
          const thisIsDerived = type === 'samples' || type === 'interpolates' || type === 'remix_of'
          if (DRY) { console.log(`  ${artist.name}『${t.title}』 ${type} ${o.primary_artist.name}『${o.title}』 ${other ? '[カタログ]' : '[カタログ外]'}`); continue }
          if (other) {
            const ok = thisIsDerived
              ? await insertRel({ track_id: t.id, related_track_id: other, relation_type: relType, note, source: 'genius' })
              : await insertRel({ track_id: other, related_track_id: t.id, relation_type: relType, note, source: 'genius' })
            if (ok) tally.linked++
          } else if (thisIsDerived && relType === 'sample') {
            if (await insertRel({ track_id: t.id, related_track_id: null, relation_type: 'sample', note, source: 'genius', original_title: o.title, original_artist: o.primary_artist.name })) tally.unresolved++
          }
        }
      }
    }
    save()
    if (tally.artists % 5 === 0) console.log(`[${tally.artists}] ${artist.name} ${JSON.stringify(tally)}`)
  }
  save()
  console.log(`=== 終了 === ${JSON.stringify(tally)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
