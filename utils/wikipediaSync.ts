// utils/wikipediaSync.ts
/**
 * 日本語Wikipediaの作品ページ(テレビアニメ・テレビドラマ)から、主題歌・挿入歌などのタイアップ候補を取り出す部品。
 *  - 年ごとのカテゴリー(「2025年のテレビアニメ」「2025年のテレビドラマ」)から作品の一覧を取る
 *  - 各作品のwikitextを取り、「主題歌」などの節と基礎情報の関連欄だけを切り出して、AIで構造化する
 * Wikipediaには1秒に1回までのペースで問い合わせる(礼儀とレート制限のため)。
 */
import { Type } from '@google/genai'
import { generateJudgementText } from '@/utils/llmJudgeChain'

const API = 'https://ja.wikipedia.org/w/api.php'
const USER_AGENT = 'music-synapse/1.0 (personal research; tie-up collection)'
const MIN_INTERVAL_MS = 1100

let lastCall = 0
export async function throttledFetch(url: string): Promise<unknown> {
  const wait = lastCall + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCall = Date.now()
  for (let attempt = 1; attempt <= 8; attempt++) {
    let res: Response
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    } catch {
      // 接続が途中で切れた(ソケットエラーなど)ときは、待ってやり直す
      await new Promise((r) => setTimeout(r, 3000 * attempt))
      lastCall = Date.now()
      continue
    }
    if (res.ok) {
      try {
        return await res.json()
      } catch {
        await new Promise((r) => setTimeout(r, 3000 * attempt))
        lastCall = Date.now()
        continue
      }
    }
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 5000 * attempt))
      lastCall = Date.now()
      continue
    }
    throw new Error(`Wikipedia API ${res.status}`)
  }
  throw new Error('Wikipedia APIが繰り返し失敗しました')
}

export type WorkKind = 'anime' | 'drama' | 'movie'

export const KIND_LABEL: Record<WorkKind, string> = { anime: 'テレビアニメ', drama: 'テレビドラマ', movie: '映画' }

/** 「2025年の日本公開映画」の記事からリンクされている映画の記事の一覧(カテゴリーが映画のものだけ)。
 * 映画は、年ごとの「日本公開映画」の記事(月ごとの一覧)に作品がまとまっているので、そのリンクをたどる。 */
export async function fetchMovieTitles(year: number): Promise<string[]> {
  const links: string[] = []
  let cont: Record<string, string> = {}
  for (let page = 0; page < 12; page++) {
    const params = new URLSearchParams({ action: 'query', prop: 'links', titles: `${year}年の日本公開映画`, pllimit: 'max', plnamespace: '0', redirects: '1', format: 'json', ...cont })
    const json = (await throttledFetch(`${API}?${params}`)) as { query?: { pages: Record<string, { links?: { title: string }[] }> }; continue?: Record<string, string> }
    for (const p of Object.values(json.query?.pages ?? {})) for (const l of p.links ?? []) links.push(l.title)
    if (!json.continue) break
    cont = json.continue
  }
  const candidates = Array.from(new Set(links.filter((t) => !/^\d{4}年|^\d+月\d*日?$|映画祭|映画賞|^第\d+回|一覧|興行|^Category:/.test(t))))
  const films: string[] = []
  for (let i = 0; i < candidates.length; i += 50) {
    const params = new URLSearchParams({ action: 'query', prop: 'categories', titles: candidates.slice(i, i + 50).join('|'), cllimit: 'max', redirects: '1', format: 'json' })
    const json = (await throttledFetch(`${API}?${params}`)) as { query?: { pages: Record<string, { title: string; categories?: { title: string }[] }> } }
    for (const p of Object.values(json.query?.pages ?? {})) {
      const cats = (p.categories ?? []).map((c) => c.title)
      // 「◯年の映画」「日本の映画作品」「…の実写映画」などに入っていて、人物・歌手などの記事ではないもの
      // その年の映画(「◯年の映画」「◯年のアニメ映画」など)に入っているものだけ。再上映・旧作(別の年のカテゴリーだけ)は除く
      if (cats.some((c) => new RegExp(`^Category:${year}年の(映画|アニメ映画|日本の映画)$`).test(c)) && !cats.some((c) => /存命人物|日本の歌手|日本の俳優/.test(c))) films.push(p.title)
    }
  }
  return Array.from(new Set(films))
}

/** 「2025年のテレビアニメ」などのカテゴリーの記事タイトル一覧。一覧記事(「…(日本)」など)は除く */
export async function fetchCategoryTitles(kind: WorkKind, year: number): Promise<string[]> {
  if (kind === 'movie') return fetchMovieTitles(year)
  const titles: string[] = []
  let cont: string | undefined
  do {
    const params = new URLSearchParams({
      action: 'query', list: 'categorymembers', cmtitle: `Category:${year}年の${KIND_LABEL[kind]}`,
      cmlimit: '500', cmnamespace: '0', format: 'json',
    })
    if (cont) params.set('cmcontinue', cont)
    const json = (await throttledFetch(`${API}?${params}`)) as { query?: { categorymembers: { title: string }[] }; continue?: { cmcontinue: string } }
    for (const m of json.query?.categorymembers ?? []) titles.push(m.title)
    cont = json.continue?.cmcontinue
  } while (cont)
  return titles.filter((t) => !/^\d{4}年の/.test(t) && !/一覧/.test(t))
}

export type WikiPage = { title: string; revisionId: number; text: string }

/** 複数ページのwikitextをまとめて取る(1回20件まで) */
export async function fetchWikitexts(titles: string[]): Promise<WikiPage[]> {
  const pages: WikiPage[] = []
  for (let i = 0; i < titles.length; i += 20) {
    const params = new URLSearchParams({
      action: 'query', prop: 'revisions', rvprop: 'content|ids', rvslots: 'main', redirects: '1',
      titles: titles.slice(i, i + 20).join('|'), format: 'json',
    })
    const json = (await throttledFetch(`${API}?${params}`)) as {
      query?: { pages: Record<string, { title: string; revisions?: { revid: number; slots: { main: { '*': string } } }[] }> }
    }
    for (const p of Object.values(json.query?.pages ?? {})) {
      const rev = p.revisions?.[0]
      if (rev) pages.push({ title: p.title, revisionId: rev.revid, text: rev.slots.main['*'] })
    }
  }
  return pages
}

const WRAPPER_TEMPLATES = new Set(['dl2', 'div col', 'columns-list', 'colbegin', 'col-begin', 'multicol', 'hidden begin', '折りたたみ', 'collapse top'])

/** wikitextを、読める文章に近づける(出典タグ・テンプレート・リンク記法を取る)。行頭の ; : * # は残す(並びの手がかり) */
export function cleanWikitext(raw: string): string {
  let t = raw
  t = t.replace(/<!--[\s\S]*?-->/g, '')
  t = t.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
  // 入れ子のテンプレートを内側から外す({{Lang|en|x}} などの中身は捨てる。主題歌の曲名は「」や[[ ]]に入っていることが多い)。
  // ただし、主題歌の一覧を包むだけのテンプレート({{dl2 … }}・{{Div col …}} など)は、中身が本文なので残す
  for (let i = 0; i < 8; i++) {
    t = t.replace(/\{\{([^{}]*)\}\}/g, (_m, inner: string) => {
      const name = inner.split('|')[0].trim().toLowerCase()
      return WRAPPER_TEMPLATES.has(name) ? '\n' + inner.replace(/^\s*[^|\n]*/, '') + '\n' : ''
    })
  }
  t = t.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
  t = t.replace(/\[https?:\/\/[^\s\]]+\s+([^\]]*)\]/g, '$1').replace(/\[https?:\/\/[^\s\]]+\]/g, '')
  t = t.replace(/'''?/g, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  return t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

const SEASON_MARK = /[（(]第\d+[期作][^）)]*[）)]/g
const normForCompare = (t: string) => t.normalize('NFKC').toLowerCase().replace(/[\s\-_/・!?！？「」『』()（）[\]【】〜~:：。．.,、]/g, '')

/** アニメ自身のタイトル。記事名は原作(漫画・小説)のタイトルのことがあり、アニメのタイトルとは違う場合がある
 * (例: 記事名「…挿れてもいいよ…」に対して、アニメ版は「…触れてもいいよ…」)。基礎情報(TVAnime)の「タイトル」欄から取る。
 * 取れなかった・複数の期が並んでいて決められない場合は null */
export function extractAnimeTitle(raw: string): string | null {
  const head = raw.slice(0, 12000)
  // 「=」のあとの空白は、改行を含めない(値が空の欄で、次の行を値として取り込まないため)
  const m = head.match(/\{\{\s*Infobox animanga\/TVAnime[\s\S]*?\n[ \t]*\|[ \t]*タイトル[ \t]*=[ \t]*([^\n]*)/i)
  if (!m) return null
  let t = m[1]
    .replace(/<br\s*\/?>/gi, '')
    .replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const marks = t.match(SEASON_MARK) ?? []
  if (marks.length > 1) return null
  t = t.replace(SEASON_MARK, '').trim()
  return t.length > 0 ? t : null
}

/** 表示する作品名を決める。アニメは、記事名と実質的に違うタイトル(原作とアニメで題名が違う場合)のときだけ、アニメ自身の
 * タイトルにする。片方がもう片方を含む(副題の有無・表記の差)なら、記事名のまま。ドラマは記事名のまま */
export function chooseWorkTitle(pageTitle: string, raw: string, kind: WorkKind): string {
  if (kind !== 'anime') return pageTitle
  const anime = extractAnimeTitle(raw)
  if (!anime) return pageTitle
  const a = normForCompare(anime)
  const p = normForCompare(pageTitle.replace(/\s*[（(][^）)]*(?:アニメ|漫画|ドラマ|小説|ゲーム|映画|作品|テレビ)[^）)]*[）)]\s*$/, ''))
  if (!a || a.includes(p) || p.includes(a)) return pageTitle
  return anime
}

const THEME_HEADING = /主題歌|主題曲|テーマソング|テーマ曲|劇中歌|挿入歌|オープニング|エンディング|OP|ED/
const STAFF_THEME_LINE = /^[*#;: ]*(主題歌|挿入歌|劇中歌|オープニングテーマ|エンディングテーマ|テーマ曲|テーマソング|主題曲|オープニング|エンディング)\s*[-－–—:：]/
const INFOBOX_KEY = /^\s*\|\s*(オープニング|エンディング|主題歌|テーマ曲|挿入歌|音楽|放送開始|放送終了|放送期間|公開)[^=]*=/

/** 主題歌などの節と、基礎情報(infobox)の関連欄だけを切り出す。無ければ空文字 */
export function extractThemeText(raw: string, maxLength = 7000): string {
  const parts: string[] = []

  // 基礎情報の関連欄((|オープニング=… などの行)。値は次の「|」行まで
  const lines = raw.split('\n')
  for (let i = 0; i < Math.min(lines.length, 260); i++) {
    if (INFOBOX_KEY.test(lines[i])) {
      let block = lines[i]
      let j = i + 1
      while (j < lines.length && !/^\s*\|[^|=]*=/.test(lines[j]) && !/^\}\}/.test(lines[j]) && j < i + 12) block += '\n' + lines[j++]
      parts.push('[基礎情報] ' + block)
    }
  }

  // 見出し(== … ==)を数えて、主題歌系の見出しの下を、同じかそれより浅い見出しまで取る
  const headings: { idx: number; level: number; title: string }[] = []
  const re = /^(={2,5})\s*([^=\n]+?)\s*\1\s*$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) headings.push({ idx: m.index, level: m[1].length, title: m[2] })
  let skipUntil = -1
  for (let k = 0; k < headings.length; k++) {
    const h = headings[k]
    if (h.idx < skipUntil) continue
    if (!THEME_HEADING.test(h.title)) continue
    let end = raw.length
    for (let n = k + 1; n < headings.length; n++) {
      if (headings[n].level <= h.level) {
        end = headings[n].idx
        break
      }
    }
    skipUntil = end
    parts.push(`[節: ${h.title}]\n` + raw.slice(h.idx, end))
  }

  // ドラマは、スタッフの箇条書き(「* 主題歌 - アーティスト「曲名」」)に書かれていることが多い。節の外でも、この形の行を拾う
  const cleanedAll = cleanWikitext(raw)
  const staffLines = cleanedAll
    .split('\n')
    .filter((l) => STAFF_THEME_LINE.test(l))
    .slice(0, 20)
  if (staffLines.length > 0) parts.push('[箇条書き]\n' + staffLines.join('\n'))

  const joined = parts.join('\n\n')
  if (!joined) return ''
  // 節・基礎情報は cleanWikitext を通していないので通す。箇条書きの行は済みなので、二重に通しても害は無い
  return cleanWikitext(joined).slice(0, maxLength)
}

export type ExtractedTieUp = {
  role: string | null; song_title: string; artist_name: string | null; note: string | null
  /** 使われた期・クール・劇場版などの区分(例: 第2期 / 劇場版)。不明・区分なしは null */
  part: string | null
  air_year: number | null
  air_month: number | null
}

/** 抽出結果の part / air_year / air_month を、安全な形に直す(年は1950〜今年+1、月は1〜12のときだけ採用) */
function partFields(e: Record<string, unknown>): { part: string | null; air_year: number | null; air_month: number | null } {
  const part = typeof e.part === 'string' && e.part.trim() ? e.part.trim().slice(0, 40) : null
  const y = Number(e.air_year)
  const m = Number(e.air_month)
  const air_year = Number.isInteger(y) && y >= 1950 && y <= new Date().getFullYear() + 1 ? y : null
  const air_month = air_year && Number.isInteger(m) && m >= 1 && m <= 12 ? m : null
  return { part, air_year, air_month }
}

const SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      role: { type: Type.STRING },
      song_title: { type: Type.STRING },
      artist_name: { type: Type.STRING },
      note: { type: Type.STRING },
      part: { type: Type.STRING },
      air_year: { type: Type.INTEGER },
      air_month: { type: Type.INTEGER },
    },
    required: ['song_title'],
  },
}

/** 切り出したテキストから、この作品に使われた歌(主題歌・挿入歌など)を取り出す */
export async function extractTieUps(workTitle: string, kind: WorkKind, themeText: string): Promise<ExtractedTieUp[]> {
  const prompt = `以下は、日本語Wikipediaの${KIND_LABEL[kind]}『${workTitle}』のページから、主題歌などに関する部分だけを抜き出した文章です。
この作品に実際に使われた「歌(楽曲)」を、すべて抽出してください。

ルール:
- 対象は、主題歌・オープニングテーマ(OP)・エンディングテーマ(ED)・挿入歌・劇中歌・ラストソングなど、名前のある歌だけ
- 作品のサウンドトラック(劇伴・BGM)、アルバム名、作曲家名だけの記述、キャラクターの声優名だけの記述は含めない
- song_title は曲名だけ(「」『』は付けない)。副題やバージョン表記(TV size など)は付けない
- artist_name は、その曲を歌っている(演奏している)アーティストの名前。ユニット名・バンド名はそのまま。不明なら省略
- role は OP / ED / 主題歌 / 挿入歌 / 劇中歌 のどれかに揃える(第1クールのOP、などは OP にして、期や話数は note に)
- note は短く(例: 「第5話」「ED2」)。40文字以内。無ければ省略(期やクールは part に書く)
- part は、その歌が使われた「期・クール・劇場版などの区分」。例: 「第1期」「第2期」「第3期第1クール」「劇場版」「OVA」。ページの見出し・並び・基礎情報から読み取れるときだけ書く。作品が1期だけで区分が無い・分からないときは省略。劇場版・映画・総集編の歌は「劇場版」にする(映画名があれば「劇場版 …」)
- air_year / air_month は、part の区分の放送(公開)が始まった年と月。[基礎情報]の「放送開始」欄に、期ごとの開始日(例: 「第1期：2019年7月6日」や、期の区切りごとに並んだ日付)が書かれているので、part に対応する開始日の年・月を必ず書く(期が複数ある作品は、日付が上から順に第1期・第2期…に当たる)。劇場版などで日付がどこにも書かれていなければ省略する(推測しない)
- 同じ曲が複数箇所に出てきたら1回だけ
- 該当する歌が書かれていなければ、空の配列を返す

--- 文章 ---
${themeText}`
  const text = await generateJudgementText(prompt, SCHEMA)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  const out: ExtractedTieUp[] = []
  for (const e of parsed as Record<string, unknown>[]) {
    const song = typeof e.song_title === 'string' ? e.song_title.trim() : ''
    if (!song) continue
    const artist = typeof e.artist_name === 'string' && e.artist_name.trim() ? e.artist_name.trim() : null
    const role = typeof e.role === 'string' && e.role.trim() ? e.role.trim() : null
    const key = `${role ?? ''}|${song}|${artist ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ role, song_title: song, artist_name: artist, note: typeof e.note === 'string' && e.note.trim() ? e.note.trim().slice(0, 60) : null, ...partFields(e) })
  }
  return out
}

/** 複数の作品(最大4件ほど)をまとめて1回で取り出す。無料枠の呼び出し回数を減らすため。
 * 作品ごとに番号を付けて渡し、結果にも番号(work_no)を付けさせて、混ざらないようにする。 */
export async function extractTieUpsBatch(
  works: { title: string; kind: WorkKind; themeText: string }[]
): Promise<ExtractedTieUp[][]> {
  if (works.length === 1) return [await extractTieUps(works[0].title, works[0].kind, works[0].themeText)]
  const sections = works
    .map((w, i) => `=== 作品${i + 1}: ${KIND_LABEL[w.kind]}『${w.title}』 ===\n${w.themeText}`)
    .join('\n\n')
  const prompt = `以下は、日本語Wikipediaの作品${works.length}件について、主題歌などに関する部分だけを抜き出した文章です(作品ごとに「=== 作品N: … ===」で区切っています)。
各作品に実際に使われた「歌(楽曲)」を、すべて抽出してください。どの作品の歌かを、work_no(作品の番号)で示してください。

ルール:
- 対象は、主題歌・オープニングテーマ(OP)・エンディングテーマ(ED)・挿入歌・劇中歌・ラストソングなど、名前のある歌だけ
- 作品のサウンドトラック(劇伴・BGM)、アルバム名、作曲家名だけの記述、キャラクターの声優名だけの記述は含めない
- ある作品の区間に書かれた歌は、必ずその作品のwork_noにする(他の作品と混ぜない)
- song_title は曲名だけ(「」『』は付けない)。副題やバージョン表記(TV size など)は付けない
- artist_name は、その曲を歌っている(演奏している)アーティストの名前。ユニット名・バンド名はそのまま。不明なら省略
- role は OP / ED / 主題歌 / 挿入歌 / 劇中歌 のどれかに揃える(第1クールのOP、などは OP にして、期や話数は note に)
- note は短く(例: 「第5話」「ED2」)。40文字以内。無ければ省略(期やクールは part に書く)
- part は、その歌が使われた「期・クール・劇場版などの区分」。例: 「第1期」「第2期」「第3期第1クール」「劇場版」「OVA」。ページの見出し・並び・基礎情報から読み取れるときだけ書く。作品が1期だけで区分が無い・分からないときは省略。劇場版・映画・総集編の歌は「劇場版」にする(映画名があれば「劇場版 …」)
- air_year / air_month は、part の区分の放送(公開)が始まった年と月。[基礎情報]の「放送開始」欄に、期ごとの開始日(例: 「第1期：2019年7月6日」や、期の区切りごとに並んだ日付)が書かれているので、part に対応する開始日の年・月を必ず書く(期が複数ある作品は、日付が上から順に第1期・第2期…に当たる)。劇場版などで日付がどこにも書かれていなければ省略する(推測しない)
- 同じ作品で同じ曲が複数箇所に出てきたら1回だけ
- 該当する歌が書かれていない作品は、何も出力しない

${sections}`
  const text = await generateJudgementText(prompt, BATCH_SCHEMA)
  const out: ExtractedTieUp[][] = works.map(() => [])
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return out
  }
  if (!Array.isArray(parsed)) return out
  const seen = works.map(() => new Set<string>())
  for (const e of parsed as Record<string, unknown>[]) {
    const no = typeof e.work_no === 'number' ? e.work_no : Number(e.work_no)
    const song = typeof e.song_title === 'string' ? e.song_title.trim() : ''
    if (!Number.isInteger(no) || no < 1 || no > works.length || !song) continue
    const artist = typeof e.artist_name === 'string' && e.artist_name.trim() ? e.artist_name.trim() : null
    const role = typeof e.role === 'string' && e.role.trim() ? e.role.trim() : null
    const key = `${role ?? ''}|${song}|${artist ?? ''}`
    if (seen[no - 1].has(key)) continue
    seen[no - 1].add(key)
    out[no - 1].push({ role, song_title: song, artist_name: artist, note: typeof e.note === 'string' && e.note.trim() ? e.note.trim().slice(0, 60) : null, ...partFields(e) })
  }
  return out
}

const BATCH_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      work_no: { type: Type.INTEGER },
      role: { type: Type.STRING },
      song_title: { type: Type.STRING },
      artist_name: { type: Type.STRING },
      note: { type: Type.STRING },
      part: { type: Type.STRING },
      air_year: { type: Type.INTEGER },
      air_month: { type: Type.INTEGER },
    },
    required: ['work_no', 'song_title'],
  },
}

/** 基礎情報の1欄の値(次の「| 欄名 =」の手前まで)を、記法を取った文字にして返す。欄が無ければ null */
function infoboxField(raw: string, names: string[]): string | null {
  const head = raw.slice(0, 15000)
  const re = new RegExp(`\\n[ \\t]*\\|[ \\t]*(?:${names.join('|')})[ \\t]*=([\\s\\S]*?)(?=\\n[ \\t]*\\|[ \\t]*[^=|\\n]{1,20}[ \\t]*=|\\n\\}\\})`)
  const m = head.match(re)
  if (!m) return null
  return m[1]
    .replace(/<ref[\s\S]*?(?:<\/ref>|\/>)/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

export const SEASON_LABELS = ['冬', '春', '夏', '秋'] as const
/** 継続(前の年から続いていて、この年に始まった放送が基礎情報に見当たらない作品) */
export const SEASON_ONGOING = '継続'

/** カテゴリーの年(year)に、この作品の放送が始まった月から「冬・春・夏・秋」を決める(1-3月=冬、4-6=春、7-9=夏、10-12=秋)。
 * 複数の期が並ぶ作品は、その年に始まった最初の放送で決める。この年に始まった記述が無ければ「継続」。基礎情報が読めなければ null */
export function extractBroadcastSeason(raw: string, year: number): string | null {
  // 複数の期が並ぶ作品は、期ごとの日付が「放送開始」「放送終了」のどちらの欄にも入っていることがある。両方を読む
  const text = ['放送開始', '放送終了', '放送期間'].map((n) => infoboxField(raw, [n]) ?? '').join('\n')
  if (!text.trim()) return null
  const months: number[] = []
  for (const m of text.matchAll(/(\d{4})年(\d{1,2})月/g)) if (Number(m[1]) === year) months.push(Number(m[2]))
  if (months.length === 0) return /\d{4}年/.test(text) ? SEASON_ONGOING : null
  const first = Math.min(...months)
  return SEASON_LABELS[Math.floor((first - 1) / 3)]
}

/** 原作の無いオリジナル作品か。「原作」欄が空、または「オリジナル」と書かれているときだけ true(欄が無いときは判断しない) */
export function isOriginalWork(raw: string): boolean {
  const v = infoboxField(raw, ['原作'])
  if (v === null) return false
  return v.replace(/\s/g, '') === '' || /オリジナル/.test(v)
}
