// scripts/match-sync-candidates.ts
/**
 * sync_candidate(Wikipediaなどから集めたタイアップ候補)を、カタログのアーティスト・曲に紐付けて、
 * 確信できたものだけを sync_work / sync_entry に反映する。
 *
 * 判定(誤った別人・別曲に紐付けない設計。曖昧なものは自動で採用しない):
 *  - アーティスト名を正規化して、カタログのアーティストと完全一致(同名が複数なら、アルバムを持つ方)
 *    「A feat. B」「A（B）」のような表記は、先頭のAでも試す
 *  - そのアーティストの曲のうち、曲名が正規化して一致するものを探す(TV size・Ver.などの付記は外して比べる)
 *  - 一致する曲が複数あれば、ライブ・カラオケ・インスト盤を除いて、最初にリリースされた版を採る
 *  → 1件に決まれば applied(sync_entry を作る)
 *  → アーティストも曲も見つからなければ unmatched(あとでiTunesから登録する対象。理由を残す)
 *  → 決めきれなければ needs_review
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/match-sync-candidates.ts [--limit=N] [--dry-run] [--retry-unmatched]
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchAllRows } from '@/utils/fetchAllRows'

const DRY_RUN = process.argv.includes('--dry-run')
const RETRY_UNMATCHED = process.argv.includes('--retry-unmatched')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : undefined

const norm = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s'’"`.,!?・&\-_/()[\]［］「」『』~〜:：;♪★☆♡×]/g, '')

/** 曲名の比較用。TV size・Short ver.・feat.表記のような「同じ曲の付記」だけを外す。
 * English ver. / Remix / Live など、別バージョンを示す表記は外さない(別の曲に紐付けないため) */
const SAME_SONG_NOTE = /[(（[［]\s*(?:tv\s*(?:size|ver\.?|edit)|short\s*(?:ver\.?|size)|feat\.?[^)）\]］]*|featuring[^)）\]］]*)\s*[)）\]］]/gi
const normTitle = (s: string) =>
  norm(
    s
      .normalize('NFKC')
      .replace(SAME_SONG_NOTE, '')
      .replace(/[-–—]\s*(?:tv\s*(?:size|ver\.?|edit)|short\s*(?:ver\.?|size))\s*[-–—]?/gi, '')
      .replace(/\s+(?:feat\.?|featuring)\s+.+$/i, '')
  )

const BAD_VERSION = /live|ライブ|karaoke|カラオケ|instrumental|インスト|off vocal|オフボーカル|acoustic|アコースティック|remix|リミックス|orchestra|オーケストラ|cover|カバー|ピアノ|piano/i

/** 歌い手の表記から、照合に使う名前の候補(完全な表記→先頭の名前)を作る */
function artistVariants(name: string): string[] {
  const out = [name]
  const first = name.split(/\s*(?:feat\.?|featuring|with|×|＆|&|、|,|と|\/|・)\s*/i)[0]?.trim()
  if (first && first !== name) out.push(first)
  const noParen = name.replace(/[（(][^）)]*[）)]/g, '').trim()
  if (noParen && !out.includes(noParen)) out.push(noParen)
  return out.filter(Boolean)
}

/** Wikipediaの記事名の末尾の曖昧さ回避((アニメ)・(漫画)・(2025年のテレビドラマ)など)を外して、作品名にする */
function cleanWorkTitle(title: string): string {
  return title.replace(/\s*[（(][^）)]*(?:アニメ|漫画|ドラマ|小説|ゲーム|映画|作品|テレビ)[^）)]*[）)]\s*$/, '').trim()
}

async function main() {
  const supabase = createAdminClient()

  const statuses = RETRY_UNMATCHED ? ['pending', 'unmatched'] : ['pending']
  const targets: {
    id: string; work_key: string; work_title: string; work_type: string; year: number | null; season_label: string | null
    role: string | null; song_title: string; artist_name: string | null; note: string | null; source_url: string
  }[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data } = await supabase.from('sync_candidate').select('*').in('status', statuses).order('created_at').range(offset, offset + 999)
    targets.push(...((data ?? []) as typeof targets))
    if ((data ?? []).length < 1000) break
  }
  const rows = LIMIT ? targets.slice(0, LIMIT) : targets
  console.log(`対象 ${rows.length}件${DRY_RUN ? '(dry-run)' : ''}\n`)

  // アーティスト名 → アーティスト(同名が複数なら、アルバムを持つ方)
  const artists = await fetchAllRows<{ id: string; name: string }>(supabase, 'artist', 'id, name', 'id')
  const albumOwners = new Set((await fetchAllRows<{ artist_id: string | null }>(supabase, 'album', 'artist_id', 'id')).map((r) => r.artist_id))
  const byName = new Map<string, { id: string; name: string }>()
  for (const a of artists) {
    const k = norm(a.name)
    const cur = byName.get(k)
    if (!cur || (!albumOwners.has(cur.id) && albumOwners.has(a.id))) byName.set(k, a)
  }

  const trackCache = new Map<string, { id: string; title: string; albumTitle: string; albumType: string | null; releaseDate: string | null }[]>()
  async function tracksOf(artistId: string) {
    const hit = trackCache.get(artistId)
    if (hit) return hit
    const { data } = await supabase.from('track').select('id, title, album:album_id(title, album_type, release_date)').eq('artist_id', artistId).limit(3000)
    const list = (data ?? []).map((t) => {
      const al = Array.isArray(t.album) ? t.album[0] : t.album
      return { id: t.id as string, title: t.title as string, albumTitle: al?.title ?? '', albumType: al?.album_type ?? null, releaseDate: al?.release_date ?? null }
    })
    trackCache.set(artistId, list)
    return list
  }

  const workIdByKey = new Map<string, string>()
  async function ensureWork(c: (typeof rows)[number]): Promise<string | null> {
    const cached = workIdByKey.get(c.work_key)
    if (cached) return cached
    const { data: ex } = await supabase.from('sync_work').select('id').eq('source_key', c.work_key).maybeSingle()
    if (ex) {
      workIdByKey.set(c.work_key, ex.id)
      return ex.id
    }
    const { data, error } = await supabase
      .from('sync_work')
      .insert({
        title: cleanWorkTitle(c.work_title), work_type: c.work_type, year: c.year, source_key: c.work_key,
        source_url: c.source_url, season_label: c.season_label,
      })
      .select('id')
      .single()
    if (error || !data) {
      console.error(`  作品の作成に失敗(${c.work_title}): ${error?.message}`)
      return null
    }
    workIdByKey.set(c.work_key, data.id)
    return data.id
  }

  const stat = { applied: 0, unmatched_artist: 0, unmatched_track: 0, needs_review: 0, dup: 0 }
  for (const c of rows) {
    const set = async (patch: Record<string, unknown>) => {
      if (!DRY_RUN) await supabase.from('sync_candidate').update(patch).eq('id', c.id)
    }
    if (!c.artist_name) {
      stat.needs_review++
      await set({ status: 'needs_review', match_reason: '歌い手の記載がなく、曲名だけでは決められない' })
      continue
    }

    let artist: { id: string; name: string } | undefined
    for (const v of artistVariants(c.artist_name)) {
      artist = byName.get(norm(v))
      if (artist) break
    }
    if (!artist) {
      stat.unmatched_artist++
      await set({ status: 'unmatched', match_method: 'exact', match_reason: `アーティスト「${c.artist_name}」がカタログに無い` })
      continue
    }

    const want = normTitle(c.song_title)
    const tracks = (await tracksOf(artist.id)).filter((t) => normTitle(t.title) === want && want.length > 0)
    if (tracks.length === 0) {
      stat.unmatched_track++
      await set({ status: 'unmatched', match_method: 'exact', match_reason: `「${artist.name}」の曲「${c.song_title}」がカタログに無い` })
      continue
    }
    // ライブ・カラオケ・インスト盤を除いて、最初にリリースされた版
    const preferred = tracks.filter((t) => !BAD_VERSION.test(t.albumTitle) && !BAD_VERSION.test(t.title))
    const pool = preferred.length > 0 ? preferred : tracks
    pool.sort((a, b) => (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999') || a.id.localeCompare(b.id))
    const chosen = pool[0]
    // 同じ最初の版に、曲名が一致する別の曲が複数あるなら、決めきれない
    const sameFirst = pool.filter((t) => t.releaseDate === chosen.releaseDate && t.albumTitle === chosen.albumTitle)
    if (sameFirst.length > 1) {
      stat.needs_review++
      await set({ status: 'needs_review', matched_track_id: chosen.id, match_method: 'exact', match_reason: '同じ盤に曲名が一致する曲が複数ある' })
      continue
    }

    if (DRY_RUN) {
      console.log(`[紐付け予定] ${c.work_title} / ${c.role ?? '-'} 「${c.song_title}」${c.artist_name} → ${artist.name}「${chosen.title}」(${chosen.albumTitle})`)
      stat.applied++
      continue
    }
    const workId = await ensureWork(c)
    if (!workId) continue
    const { data: entry, error } = await supabase
      .from('sync_entry')
      .insert({ sync_work_id: workId, track_id: chosen.id, usage_detail: c.note, role: c.role || null, source_url: c.source_url, match_method: 'exact', confidence: 1, candidate_id: c.id })
      .select('id')
      .single()
    if (error?.code === '23505') {
      stat.dup++
      await set({ status: 'applied', matched_track_id: chosen.id, match_method: 'exact', match_confidence: 1, match_reason: '同じ作品・曲・役割が反映済み' })
      continue
    }
    if (error || !entry) {
      console.error(`  反映に失敗(${c.work_title}/${c.song_title}): ${error?.message}`)
      continue
    }
    stat.applied++
    await set({ status: 'applied', matched_track_id: chosen.id, match_method: 'exact', match_confidence: 1, match_reason: null, applied_entry_id: entry.id })
  }

  console.log(`\n=== 結果${DRY_RUN ? '(dry-run)' : ''} ===`)
  console.log(`紐付け・反映 ${stat.applied}件 / 既に反映済み ${stat.dup}件 / アーティスト未登録 ${stat.unmatched_artist}件 / 曲が未登録 ${stat.unmatched_track}件 / 確認待ち ${stat.needs_review}件`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
