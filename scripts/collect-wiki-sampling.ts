// scripts/collect-wiki-sampling.ts
/**
 * 日本語Wikipediaの曲・シングルの記事から、サンプリング(引用・補間を含む)の関係を集めて track_relation('sample')に入れる。
 *   アーティスト(Wikidataの日本語版記事あり)の記事 → リンクされた記事のうち、カテゴリーが「<本人>の楽曲/曲/シングル」のもの →
 *   カタログの同じアーティストの曲と題名が完全一致したものだけ → 本文にサンプリング・引用などの言及がある記事だけLLMで読む →
 *   「この曲が使っている元の曲」「この曲を使った曲」を取り出し、曲名+アーティスト名がカタログと完全一致したら、曲どうしを結ぶ。
 *   元の曲がカタログに無いときは、名前だけを残す(original_title / original_artist)。
 * LLM(無料枠)とWikipediaだけを使い、iTunesは使わない。再開できる(状態は /private/tmp/wiki-sampling-state.json)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/collect-wiki-sampling.ts [--max-minutes=N] [--limit-artists=N] [--dry-run]
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { Type } from '@google/genai'
import { createAdminClient } from '@/utils/Supabase/admin'
import { AllProvidersExhaustedError, generateJudgementText } from '@/utils/llmJudgeChain'
import { fetchWikitexts, throttledFetch } from '@/utils/wikipediaSync'

const STATE = '/private/tmp/wiki-sampling-state.json'
const MAX_MIN = Number(process.argv.find((a) => a.startsWith('--max-minutes='))?.split('=')[1] ?? 0)
const LIMIT_ARTISTS = Number(process.argv.find((a) => a.startsWith('--limit-artists='))?.split('=')[1] ?? 0)
const DRY = process.argv.includes('--dry-run')
const API = 'https://ja.wikipedia.org/w/api.php'
const WD = 'https://www.wikidata.org/w/api.php'
const MENTION = /サンプリング|サンプル|引用|元ネタ|ネタ元|インターポレーション|interpolat|sampl|リミックス元|マッシュアップ/i

type State = { artistsDone: string[]; tracksDone: Record<string, string> }
const state: State = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { artistsDone: [], tracksDone: {} }
const save = () => {
  if (!DRY) writeFileSync(STATE, JSON.stringify(state))
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s'’"“”.,!?・&\-_/()[\]:：〜~☆★♪]/g, '')
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const q = (o: Record<string, string>) => new URLSearchParams({ format: 'json', ...o }).toString()

async function jawikiTitles(qids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < qids.length; i += 50) {
    const json = (await throttledFetch(`${WD}?${q({ action: 'wbgetentities', ids: qids.slice(i, i + 50).join('|'), props: 'sitelinks', sitefilter: 'jawiki' })}`)) as {
      entities?: Record<string, { sitelinks?: { jawiki?: { title: string } } }>
    }
    for (const [id, e] of Object.entries(json.entities ?? {})) if (e.sitelinks?.jawiki?.title) out.set(id, e.sitelinks.jawiki.title)
  }
  return out
}

async function songArticles(artistTitle: string): Promise<string[]> {
  const links: string[] = []
  let cont: Record<string, string> = {}
  for (let page = 0; page < 6; page++) {
    const json = (await throttledFetch(`${API}?${q({ action: 'query', titles: artistTitle, prop: 'links', pllimit: 'max', plnamespace: '0', redirects: '1', ...cont })}`)) as {
      query?: { pages: Record<string, { links?: { title: string }[] }> }
      continue?: Record<string, string>
    }
    for (const p of Object.values(json.query?.pages ?? {})) for (const l of p.links ?? []) links.push(l.title)
    if (!json.continue) break
    cont = json.continue
  }
  const base = esc(artistTitle.replace(/\s*\(.*\)$/, ''))
  const want = new RegExp(`^(Category|カテゴリ):${base}の(楽曲|曲|シングル)$`)
  const found: string[] = []
  for (let i = 0; i < links.length; i += 50) {
    const json = (await throttledFetch(`${API}?${q({ action: 'query', titles: links.slice(i, i + 50).join('|'), prop: 'categories', cllimit: 'max', redirects: '1' })}`)) as {
      query?: { pages: Record<string, { title: string; categories?: { title: string }[] }> }
    }
    for (const p of Object.values(json.query?.pages ?? {})) if ((p.categories ?? []).some((c) => want.test(c.title))) found.push(p.title)
  }
  return Array.from(new Set(found))
}

/** 本文から、サンプリングなどの言及がある段落を取り出す */
function mentionText(raw: string): string {
  const cleaned = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
  const paras = cleaned.split(/\n+/).filter((p) => MENTION.test(p))
  return paras.join('\n').slice(0, 3500)
}

type Extracted = { work_no: number; direction: string; song_title: string; artist_name: string; kind: string }
const SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      work_no: { type: Type.INTEGER },
      direction: { type: Type.STRING },
      song_title: { type: Type.STRING },
      artist_name: { type: Type.STRING },
      kind: { type: Type.STRING },
    },
    required: ['work_no', 'direction', 'song_title'],
  },
}

async function extract(works: { title: string; artist: string; text: string }[]): Promise<Extracted[]> {
  const sections = works.map((w, i) => `=== 作品${i + 1}: ${w.artist}『${w.title}』 ===\n${w.text}`).join('\n\n')
  const prompt = `以下は、日本語Wikipediaの曲の記事${works.length}件から、サンプリング・引用などに触れた段落だけを抜き出した文章です(作品ごとに「=== 作品N ===」で区切っています)。
各作品について、「サンプリング(音源の一部の使用)・インターポレーション(メロディや歌詞の引用)」の関係を抽出してください。

direction は次のどちらか:
- uses: その作品が、別の曲の一部を使っている(別の曲が元ネタ)。song_title / artist_name は、元ネタの曲
- used_by: 別の曲が、その作品の一部を使っている(その作品が元ネタ)。song_title / artist_name は、使った側の曲
kind は sample(音源の使用)か interpolation(再演・引用)のどちらか。

ルール:
- 本文に曲名とアーティスト名がはっきり書かれているものだけ。推測しない
- カバー(歌い直し)・リミックス・影響を受けただけ・似ているだけ、は含めない
- 曲名は曲名だけ(「」や『』を付けない)。アーティスト名が書かれていなければ空にする
- 関係が何も書かれていない作品は、何も出力しない

${sections}`
  const text = await generateJudgementText(prompt, SCHEMA)
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? (parsed as Extracted[]) : []
  } catch {
    return []
  }
}

async function main() {
  const supabase = createAdminClient()
  const started = Date.now()

  const qidOf = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('artist_external_link').select('artist_id, url').eq('link_type', 'wikidata').range(from, from + 999)
    for (const r of data ?? []) {
      const m = (r.url as string).match(/\/(Q\d+)$/)
      if (m) qidOf.set(r.artist_id as string, m[1])
    }
    if ((data ?? []).length < 1000) break
  }
  const priority = new Map<string, number>()
  for (const [table, w] of [['ranking_entry', 3], ['award_entry', 3], ['event_appearance_artist', 1]] as const) {
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from(table).select('artist_id').not('artist_id', 'is', null).range(from, from + 999)
      for (const r of data ?? []) priority.set(r.artist_id as string, (priority.get(r.artist_id as string) ?? 0) + w)
      if ((data ?? []).length < 1000) break
    }
  }
  const done = new Set(state.artistsDone)
  const ids = Array.from(qidOf.keys()).filter((id) => !done.has(id)).sort((a, b) => (priority.get(b) ?? 0) - (priority.get(a) ?? 0))
  console.log(`対象 ${ids.length}(処理済み ${done.size})`)

  // 重複(同じ関係の2回目)は、一意制約のエラー(23505)になるので、何もしない
  async function insertRel(row: Record<string, unknown>): Promise<boolean> {
    const { error } = await supabase.from('track_relation').insert(row)
    return !error
  }

  // 曲の照合(アーティスト名 → 曲)
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

  const tally = { artists: 0, articles: 0, read: 0, linked: 0, unresolved: 0 }
  let nth = 0
  for (let i = 0; i < ids.length; i += 50) {
    if (LIMIT_ARTISTS && nth >= LIMIT_ARTISTS) break
    if (MAX_MIN && (Date.now() - started) / 60000 > MAX_MIN) break
    const group = ids.slice(i, i + 50)
    const titles = await jawikiTitles(group.map((id) => qidOf.get(id)!))
    for (const artistId of group) {
      if (LIMIT_ARTISTS && nth >= LIMIT_ARTISTS) break
      if (MAX_MIN && (Date.now() - started) / 60000 > MAX_MIN) break
      nth++
      tally.artists++
      state.artistsDone.push(artistId)
      const title = titles.get(qidOf.get(artistId)!)
      if (!title) continue
      const { data: artist } = await supabase.from('artist').select('id, name').eq('id', artistId).maybeSingle()
      if (!artist) continue
      const { data: tracks } = await supabase.from('track').select('id, title').eq('artist_id', artistId).limit(3000)
      if (!tracks?.length) continue
      const byTitle = new Map<string, { id: string; title: string }>()
      for (const t of tracks) if (!byTitle.has(norm(t.title as string))) byTitle.set(norm(t.title as string), { id: t.id as string, title: t.title as string })

      let articles: string[] = []
      try {
        articles = await songArticles(title)
      } catch {
        continue
      }
      const matched = articles
        .map((a) => ({ article: a, track: byTitle.get(norm(a.replace(/\s*\([^)]*\)$/, ''))) }))
        .filter((x): x is { article: string; track: { id: string; title: string } } => !!x.track && !state.tracksDone[x.track.id])
      if (!matched.length) continue
      tally.articles += matched.length

      const pages = await fetchWikitexts(matched.map((m) => m.article))
      const textBy = new Map(pages.map((p) => [p.title, mentionText(p.text)]))
      const work = matched.map((m) => ({ ...m, text: textBy.get(m.article) ?? '' }))
      for (const w of work) if (w.text.length < 20) state.tracksDone[w.track.id] = 'no-mention'
      const readable = work.filter((w) => w.text.length >= 20)
      tally.read += readable.length
      for (let j = 0; j < readable.length; j += 3) {
        const g = readable.slice(j, j + 3)
        let ex: Extracted[]
        try {
          ex = await extract(g.map((x) => ({ title: x.track.title, artist: artist.name as string, text: x.text })))
        } catch (e) {
          if (e instanceof AllProvidersExhaustedError) {
            state.artistsDone = state.artistsDone.filter((x) => x !== artistId)
            save()
            console.log(`\nLLMの無料枠が尽きたため止めます。${JSON.stringify(tally)}`)
            process.exit(75)
          }
          continue
        }
        for (const [k, w] of g.entries()) {
          state.tracksDone[w.track.id] = 'read'
          for (const r of ex.filter((x) => x.work_no === k + 1)) {
            if (!r.song_title?.trim()) continue
            // 取り出された曲名・アーティスト名が、実際に本文に書かれているものだけ採用する(LLMの取り違え・作り話を除く)
            const hay = w.text.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
            const has = (v: string) => hay.includes(v.normalize('NFKC').toLowerCase().replace(/\s+/g, ''))
            if (!has(r.song_title.trim()) || (r.artist_name?.trim() && !has(r.artist_name.trim()))) continue
            const other = r.artist_name?.trim() ? await findTrack(r.artist_name.trim(), r.song_title.trim()) : null
            const note = `${r.kind === 'interpolation' ? '引用・再演' : 'サンプリング'}(Wikipedia: ${w.article})`
            if (DRY) { console.log(`  ${artist.name}『${w.track.title}』 ${r.direction} ${r.artist_name}『${r.song_title}』 ${other ? '[カタログ]' : '[カタログ外]'}`); continue }
            // uses: この曲(derived) → 元の曲(original)。used_by: 使った側(derived) → この曲(original)
            if (r.direction === 'used_by') {
              if (!other) continue // 使った側がカタログに無いと、行の持ち主が決まらない
              if (await insertRel({ track_id: other, related_track_id: w.track.id, relation_type: 'sample', note, source: 'wikipedia' })) tally.linked++
            } else if (other) {
              if (await insertRel({ track_id: w.track.id, related_track_id: other, relation_type: 'sample', note, source: 'wikipedia' })) tally.linked++
            } else {
              if (await insertRel({ track_id: w.track.id, related_track_id: null, relation_type: 'sample', note, source: 'wikipedia', original_title: r.song_title.trim(), original_artist: r.artist_name?.trim() || null })) tally.unresolved++
            }
          }
        }
      }
    }
    save()
    console.log(`[${nth}] ${JSON.stringify(tally)}`)
  }
  save()
  console.log(`=== 終了 === ${JSON.stringify(tally)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
