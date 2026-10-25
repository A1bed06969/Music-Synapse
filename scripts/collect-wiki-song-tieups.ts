// scripts/collect-wiki-song-tieups.ts
/**
 * 日本語Wikipediaの曲・シングルの記事から、CM・テレビ番組・WEB番組などのタイアップを集めて sync_candidate に入れる
 * (アニメ・ドラマ・映画は、作品の記事から読む collect-sync-candidates.ts が担当するので、ここでは対象外)。
 *   アーティスト(Wikidataの日本語版記事あり)の記事 → リンクされた記事のうち、カテゴリーが「<本人>の楽曲/曲/シングル」のもの →
 *   カタログの同じアーティストの曲と題名が完全一致したものだけ → 本文にCM・番組・タイアップの言及がある記事だけLLMで読む →
 *   作品(CMの商品名・番組名)・種別・役割(CMソング/エンディングテーマなど)・年を取り出す。
 *   年が2020〜2026のものだけ採用する(それ以前・年不明は入れない)。
 * 曲との紐付けは match-sync-candidates.ts が行う(曲はすでにカタログにあるので、完全一致で確定する)。
 * LLM(無料枠)とWikipediaだけを使い、iTunesは使わない。再開できる(状態は /private/tmp/wiki-tieup-state.json)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/collect-wiki-song-tieups.ts [--max-minutes=N] [--limit-artists=N] [--dry-run]
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { Type } from '@google/genai'
import { createAdminClient } from '@/utils/Supabase/admin'
import { AllProvidersExhaustedError, generateJudgementText } from '@/utils/llmJudgeChain'
import { fetchWikitexts, throttledFetch } from '@/utils/wikipediaSync'

const STATE = '/private/tmp/wiki-tieup-state.json'
const MAX_MIN = Number(process.argv.find((a) => a.startsWith('--max-minutes='))?.split('=')[1] ?? 0)
const LIMIT_ARTISTS = Number(process.argv.find((a) => a.startsWith('--limit-artists='))?.split('=')[1] ?? 0)
const DRY = process.argv.includes('--dry-run')
const API = 'https://ja.wikipedia.org/w/api.php'
const WD = 'https://www.wikidata.org/w/api.php'
const MENTION = /CM|コマーシャル|タイアップ|番組|エンディング|オープニング|テーマソング|イメージソング|キャンペーンソング|応援ソング|テーマ曲|主題歌/

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
  return paras.join('\n').slice(0, 4000)
}

type Extracted = { work_no: number; work_title: string; work_type: string; role: string; year: number }
const SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      work_no: { type: Type.INTEGER },
      work_title: { type: Type.STRING },
      work_type: { type: Type.STRING },
      role: { type: Type.STRING },
      year: { type: Type.INTEGER },
    },
    required: ['work_no', 'work_title', 'work_type'],
  },
}

async function extract(works: { title: string; artist: string; text: string }[]): Promise<Extracted[]> {
  const sections = works.map((w, i) => `=== 作品${i + 1}: ${w.artist}『${w.title}』 ===\n${w.text}`).join('\n\n')
  const prompt = `以下は、日本語Wikipediaの曲の記事${works.length}件から、タイアップ(CM・番組・映画・ドラマなどでの起用)に触れた段落だけを抜き出した文章です(作品ごとに「=== 作品N ===」で区切っています)。
各曲が、何に使われたか(タイアップ)を、すべて抽出してください。

work_type は次のどれか:
- cm: テレビ・WEBのCM(商品・企業・キャンペーンのCM)。work_title は、商品名・企業名・キャンペーン名(例: 「サントリー 伊右衛門」)
- tv_program: テレビのバラエティ・音楽・情報・スポーツ・ニュースなどの番組(ドラマ・アニメを除く)。work_title は番組名
- web_program: 配信・WEBの番組・企画
- other: 上のどれでもない(映画・ドラマ・アニメ・ゲームなどは other にする)
role は、CMソング / テーマソング / オープニングテーマ / エンディングテーマ / イメージソング / キャンペーンソング / 応援ソング のどれかに揃える。
year は、そのタイアップが始まった(放送・公開された)年(西暦の4桁)。書かれていなければ省略する。

ルール:
- 本文にはっきり書かれているものだけ。推測しない
- 作品が曲名そのものの紹介(MV・ライブ・歌詞の説明)は、タイアップではないので含めない
- 同じ作品・役割は1回だけ

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

  // 同じ候補(作品・役割・曲・アーティスト)の2回目は、一意制約のエラーになるだけで、何もしない
  async function insertCandidate(row: Record<string, unknown>): Promise<boolean> {
    const { error } = await supabase.from('sync_candidate').insert(row)
    return !error
  }

  const tally = { artists: 0, articles: 0, read: 0, candidates: 0, skippedYear: 0 }
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
          const url = `https://ja.wikipedia.org/wiki/${encodeURIComponent(w.article.replace(/ /g, '_'))}`
          for (const r of ex.filter((x) => x.work_no === k + 1)) {
            const type = r.work_type === 'cm' ? 'cm' : r.work_type === 'tv_program' || r.work_type === 'web_program' ? 'tv_program' : null
            if (!type || !r.work_title?.trim()) continue // アニメ・ドラマ・映画などは、作品の記事から読む別の収集が担当する
            // 取り出された作品名が、実際に本文に書かれているものだけ採用する
            const hay = w.text.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
            if (!hay.includes(r.work_title.trim().normalize('NFKC').toLowerCase().replace(/\s+/g, ''))) continue
            if (!r.year || r.year < 2020 || r.year > 2026) { tally.skippedYear++; continue }
            const role = r.role?.trim() || ''
            if (DRY) { console.log(`  ${artist.name}『${w.track.title}』 ${type} ${r.year} ${role} ${r.work_title}`); continue }
            const ok = await insertCandidate({
              work_key: `wikisong:${type}:${r.work_title.trim()}`, work_title: r.work_title.trim(), work_type: type, year: r.year,
              role, song_title: w.track.title, artist_name: artist.name as string, note: null, source_url: url, status: 'pending',
            })
            if (ok) tally.candidates++
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
