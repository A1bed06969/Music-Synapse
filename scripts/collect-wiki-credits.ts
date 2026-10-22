// scripts/collect-wiki-credits.ts
/**
 * 日本語Wikipediaのアルバム・シングルの記事の「収録曲」の表から、作詞・作曲・編曲・プロデュースを集めてクレジットに入れる。
 *   アーティスト(Wikidataの日本語版記事あり)の記事 → そこからリンクされた記事のうち、カテゴリーが「◯◯のアルバム/シングル/EP」
 *   (◯◯が本人の記事名)のもの → カタログのアルバムと題名が完全一致したものだけ → 収録曲の表をLLMで読む →
 *   曲名が完全一致したトラックに、作詞・作曲・編曲を付ける(アルバム全体のプロデュースはアルバムに付ける)。
 * 誤紐付けを避けるため: カテゴリーが本人のものであること・題名とトラック名が完全一致であることを条件にし、あいまいなものは入れない。
 * 人物は credit_person(名前だけ)に、名前がカタログのアーティストと1人に決まれば artist_relation('production')にも。
 * LLM(無料枠)とWikipediaだけを使い、iTunesは使わない。再開できる(状態は /private/tmp/wiki-credits-state.json)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/collect-wiki-credits.ts [--max-minutes=N] [--limit-artists=N] [--dry-run]
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { Type } from '@google/genai'
import { createAdminClient } from '@/utils/Supabase/admin'
import { AllProvidersExhaustedError, generateJudgementText } from '@/utils/llmJudgeChain'
import { fetchWikitexts, throttledFetch } from '@/utils/wikipediaSync'
import { writeAlbumCredits, type UnifiedCreditInput } from '@/utils/creditImport'

const STATE = '/private/tmp/wiki-credits-state.json'
const MAX_MIN = Number(process.argv.find((a) => a.startsWith('--max-minutes='))?.split('=')[1] ?? 0)
const LIMIT_ARTISTS = Number(process.argv.find((a) => a.startsWith('--limit-artists='))?.split('=')[1] ?? 0)
const DRY = process.argv.includes('--dry-run')
const API = 'https://ja.wikipedia.org/w/api.php'
const WD = 'https://www.wikidata.org/w/api.php'

type State = { artistsDone: string[]; albumsDone: Record<string, string> }
const state: State = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { artistsDone: [], albumsDone: {} }
const save = () => { if (!DRY) writeFileSync(STATE, JSON.stringify(state)) }

const norm = (s: string) =>
  s.normalize('NFKC').toLowerCase().replace(/\s*-\s*(single|ep)$/i, '').replace(/[\s'’"“”.,!?・&\-_/()[\]:：〜~☆★♪]/g, '')
const q = (o: Record<string, string>) => new URLSearchParams({ format: 'json', ...o }).toString()

/** Wikidata の ID → 日本語版の記事名(50件ずつ) */
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

/** 記事からリンクされている記事のうち、カテゴリーが「<本人>のアルバム/シングル/EP」のもの */
async function discographyArticles(artistTitle: string): Promise<string[]> {
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
  const base = artistTitle.replace(/\s*\(.*\)$/, '')
  const want = new RegExp(`^Category:${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}の(アルバム|シングル|EP)$|^カテゴリ:${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}の(アルバム|シングル|EP)$`)
  const found: string[] = []
  for (let i = 0; i < links.length; i += 50) {
    const chunk = links.slice(i, i + 50)
    const json = (await throttledFetch(`${API}?${q({ action: 'query', titles: chunk.join('|'), prop: 'categories', cllimit: 'max', redirects: '1' })}`)) as {
      query?: { pages: Record<string, { title: string; categories?: { title: string }[] }> }
    }
    for (const p of Object.values(json.query?.pages ?? {})) if ((p.categories ?? []).some((c) => want.test(c.title))) found.push(p.title)
  }
  return Array.from(new Set(found))
}

/** 「収録曲」などの節を取り出し、読みやすくする(テンプレートは残す。{{Track listing}} に作詞・作曲が入っていることが多い) */
function trackSection(raw: string): string {
  const re = /^(={2,4})\s*([^=\n]+?)\s*\1\s*$/gm
  const heads: { idx: number; level: number; title: string }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) heads.push({ idx: m.index, level: m[1].length, title: m[2] })
  const parts: string[] = []
  for (let k = 0; k < heads.length; k++) {
    if (!/収録曲|曲目|トラックリスト|収録内容|楽曲/.test(heads[k].title)) continue
    let end = raw.length
    for (let n = k + 1; n < heads.length; n++) if (heads[n].level <= heads[k].level) { end = heads[n].idx; break }
    parts.push(raw.slice(heads[k].idx, end))
  }
  return parts
    .join('\n\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/<br\s*\/?>/gi, ' / ')
    .replace(/'''?/g, '')
    .replace(/[ \t]+/g, ' ')
    .slice(0, 7000)
}

type Extracted = { work_no: number; track_title: string; lyricist: string; composer: string; arranger: string; producer: string }
const SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      work_no: { type: Type.INTEGER },
      track_title: { type: Type.STRING },
      lyricist: { type: Type.STRING },
      composer: { type: Type.STRING },
      arranger: { type: Type.STRING },
      producer: { type: Type.STRING },
    },
    required: ['work_no', 'track_title'],
  },
}

async function extractCredits(works: { title: string; text: string }[]): Promise<Extracted[]> {
  const sections = works.map((w, i) => `=== 作品${i + 1}: 『${w.title}』 ===\n${w.text}`).join('\n\n')
  const prompt = `以下は、日本語Wikipediaのアルバム・シングル${works.length}件の「収録曲」の節です(作品ごとに「=== 作品N ===」で区切っています)。
各曲の「作詞・作曲・編曲」と、書かれていれば「プロデュース」を抽出してください。どの作品の曲かを work_no で示してください。

ルール:
- 書かれている人名だけを使う。書かれていない欄は空にする(推測しない)
- 複数人は「、」で区切って1つの文字列にする。「作詞・作曲」が同じ人なら、作詞と作曲の両方に同じ名前を入れる
- 人名は、表記の注記(「(日本語詞)」「(補作詞)」など)や役割の文字を付けず、名前だけにする
- track_title は曲名だけ(「」や『』を付けない。曲の長さ・番号は含めない)
- 曲のクレジットが何も書かれていない作品は、何も出力しない

${sections}`
  const text = await generateJudgementText(prompt, SCHEMA)
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? (parsed as Extracted[]) : []
  } catch {
    return []
  }
}

const splitNames = (s: string | undefined) =>
  (s ?? '').split(/[、,，/／]|\s+・\s+/).map((x) => x.replace(/[(（][^)）]*[)）]/g, '').trim()).filter((x) => x && x.length <= 40)

async function main() {
  const supabase = createAdminClient()
  const started = Date.now()

  // 対象: Wikidata ID を持つアーティスト(アルバムがあり、まだ処理していない人)
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

  const tally = { artists: 0, withArticle: 0, articles: 0, albumsMatched: 0, credits: 0, relations: 0 }
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
      const { data: artist } = await supabase.from('artist').select('id, name').eq('id', artistId).maybeSingle()
      const title = titles.get(qidOf.get(artistId)!)
      state.artistsDone.push(artistId)
      if (!artist || !title) continue
      tally.withArticle++
      const { data: albums } = await supabase.from('album').select('id, title').eq('artist_id', artistId)
      if (!albums?.length) continue
      const byTitle = new Map<string, { id: string; title: string }>()
      for (const a of albums) byTitle.set(norm(a.title as string), { id: a.id as string, title: a.title as string })

      let articles: string[] = []
      try {
        articles = await discographyArticles(title)
      } catch (e) {
        console.error(`  ${artist.name}: 記事の一覧に失敗 ${(e as Error).message.slice(0, 60)}`)
        continue
      }
      const matched = articles
        .map((t) => ({ article: t, album: byTitle.get(norm(t.replace(/\s*\([^)]*\)$/, ''))) }))
        .filter((x): x is { article: string; album: { id: string; title: string } } => !!x.album && !state.albumsDone[x.album.id])
      if (!matched.length) continue
      tally.articles += matched.length

      const pages = await fetchWikitexts(matched.map((m) => m.article))
      const textBy = new Map(pages.map((p) => [p.title, trackSection(p.text)]))
      const work = matched.map((m) => ({ ...m, text: textBy.get(m.article) ?? '' })).filter((m) => m.text.length > 40)
      for (let j = 0; j < work.length; j += 3) {
        const group3 = work.slice(j, j + 3)
        let extracted: Extracted[]
        try {
          extracted = await extractCredits(group3.map((g) => ({ title: g.album.title, text: g.text })))
        } catch (e) {
          if (e instanceof AllProvidersExhaustedError) {
            // この人は途中なので、再開時にやり直せるよう「処理済み」から外す
            state.artistsDone = state.artistsDone.filter((x) => x !== artistId)
            save()
            console.log(`\nLLMの無料枠が尽きたため止めます。${JSON.stringify(tally)}`)
            process.exit(75)
          }
          continue
        }
        for (const [k, g] of group3.entries()) {
          const rows = extracted.filter((x) => x.work_no === k + 1)
          state.albumsDone[g.album.id] = rows.length ? 'ok' : 'none'
          if (!rows.length) continue
          const { data: tracks } = await supabase.from('track').select('id, title').eq('album_id', g.album.id)
          const trackByTitle = new Map((tracks ?? []).map((t) => [norm(t.title as string), t.id as string]))
          const inputs: UnifiedCreditInput[] = []
          const sourceUrl = `https://ja.wikipedia.org/wiki/${encodeURIComponent(g.article.replace(/ /g, '_'))}`
          for (const r of rows) {
            const trackId = trackByTitle.get(norm(r.track_title ?? '')) ?? null
            if (!trackId) continue // 曲名が完全一致しない行は入れない
            for (const [field, role] of [['lyricist', 'lyricist'], ['composer', 'composer'], ['arranger', 'arranger'], ['producer', 'producer']] as const) {
              for (const name of splitNames(r[field])) inputs.push({ personName: name, personSourceId: `wiki:${name}`, source: 'wikipedia', role, sourceUrl, trackId, instrumentName: null })
            }
          }
          if (!inputs.length) continue
          tally.albumsMatched++
          if (DRY) { console.log(`  ${artist.name}『${g.album.title}』: ${inputs.length}件`); continue }
          const res = await writeAlbumCredits(supabase, artistId, g.album.id, inputs)
          tally.credits += res.creditsWritten
          tally.relations += res.relationsWritten
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
