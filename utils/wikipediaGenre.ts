// utils/wikipediaGenre.ts
//
// ジャンルの発祥年・発祥地・起源ジャンル・派生ジャンルを、Wikipediaの
// {{Infobox music genre}}テンプレートから取り込むためのユーティリティ。
// 日本語版を先に試し、記事/インフォボックスが無ければ英語版にフォールバックする
// (日本発ジャンルはja版、洋楽ジャンルはen版が充実している想定、実データで確認済み)。
// ジャンルには専用のAPIが無いため(MusicBrainzのgenreは単なるタグ)、Wikipedia
// REST API(action=parse&prop=wikitext)で生wikitextを取得し正規表現で解析する。

const USER_AGENT = 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'

export type WikipediaGenreInfo = {
  sourceUrl: string
  originYear: number | null
  originPlace: string | null
  stylisticOrigins: string[]
  subgenres: string[]
  derivatives: string[]
}

async function fetchWikitext(
  lang: 'ja' | 'en',
  title: string
): Promise<{ wikitext: string; resolvedTitle: string } | null> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&format=json&prop=wikitext&section=0&redirects=1`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) return null
  const data = await res.json()
  if (data.error) return null
  const wikitext = data.parse?.wikitext?.['*']
  const resolvedTitle = data.parse?.title
  if (!wikitext || !resolvedTitle) return null
  return { wikitext, resolvedTitle }
}

// {{...}}はネストしうる(インフォボックス内に{{hlist|...}}や{{cite news|...}}が
// 入れ子で現れる)ため、単純な非貪欲正規表現では閉じタグを取り違える。
// 開き位置から深さを数えて対応する閉じ位置を探す。
function findMatchingClose(text: string, openIndex: number): number {
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    if (text.startsWith('{{', i)) {
      depth++
      i++
    } else if (text.startsWith('}}', i)) {
      depth--
      i++
      if (depth === 0) return i + 1
    }
  }
  return -1
}

function extractInfobox(wikitext: string): string | null {
  const match = wikitext.match(/\{\{\s*Infobox music genre/i)
  if (!match || match.index === undefined) return null
  const end = findMatchingClose(wikitext, match.index)
  if (end === -1) return null
  return wikitext.slice(match.index, end)
}

function extractFieldRaw(infobox: string, field: string): string | null {
  const re = new RegExp(`\\|\\s*${field}\\s*=([\\s\\S]*?)(?=\\n\\s*\\|\\s*[a-zA-Z_]+\\s*=|\\n\\}\\}\\s*$)`, 'i')
  const m = infobox.match(re)
  return m ? m[1].trim() : null
}

// [[記事名|表示名]] または [[記事名]] から表示用の名前だけを順番に取り出す。
// {{hlist|...}}/{{Plainlist|...}}のようなラッパーテンプレートは中のリンクだけ
// 拾えば十分で、{{JPN}}のような他のテンプレートは(リンク構文ではないため)
// 自然に無視される。
function extractLinkNames(text: string): string[] {
  const names: string[] = []
  const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const name = (m[2] ?? m[1]).trim()
    if (name) names.push(name)
  }
  return names
}

const COUNTRY_TEMPLATE_JA: Record<string, string> = {
  JPN: '日本',
  USA: 'アメリカ合衆国',
  GBR: 'イギリス',
  FRA: 'フランス',
  DEU: 'ドイツ',
  JAM: 'ジャマイカ',
}

// cultural_origins欄は書式が英語版・日本語版で大きく異なる:
//   英語版: 自由文 "Mid-1980s, [[Detroit]], [[Michigan]], U.S."
//   日本語版: {{Plainlist| * [[1970年代]] * {{JPN}} }} のような箇条書き+国旗テンプレート
// どちらのパターンにも対応するため、リンク由来の年/地名、国旗テンプレート由来の
// 国名、自由文由来の年をそれぞれ試し、取れたものを組み合わせるベストエフォート方式にする
// (都市までは分離しない場合がある、という前提はspec通り)。
function extractCulturalOrigin(fieldRaw: string): { year: number | null; place: string | null } {
  const countryNames: string[] = []
  const templateRe = /\{\{\s*([A-Za-z]{2,5})\s*\}\}/g
  let tm: RegExpExecArray | null
  while ((tm = templateRe.exec(fieldRaw))) {
    const jaName = COUNTRY_TEMPLATE_JA[tm[1].toUpperCase()]
    if (jaName) countryNames.push(jaName)
  }

  const linkNames = extractLinkNames(fieldRaw)
  const yearLink = linkNames.find((n) => /^\d{4}/.test(n))
  const placeFromLinks = linkNames.filter((n) => !/^\d{4}/.test(n))

  const plainText = fieldRaw
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, d) => d ?? a)
  const plainYearMatch = plainText.match(/\d{4}/)

  const yearSource = yearLink ?? (plainYearMatch ? plainYearMatch[0] : null)
  const year = yearSource ? parseInt(yearSource.slice(0, 4), 10) : null

  const placeParts = [...countryNames, ...placeFromLinks]
  if (placeParts.length === 0) {
    const withoutYear = plainText
      .replace(/\d{4}s?/, '')
      .replace(/^[,*\s]+|[,*\s]+$/g, '')
      .trim()
    if (withoutYear) placeParts.push(withoutYear)
  }

  return { year, place: placeParts.length > 0 ? placeParts.join(', ') : null }
}

export function parseGenreInfobox(wikitext: string, sourceUrl: string): WikipediaGenreInfo | null {
  const infobox = extractInfobox(wikitext)
  if (!infobox) return null

  const culturalRaw = extractFieldRaw(infobox, 'cultural_origins')
  const { year, place } = culturalRaw ? extractCulturalOrigin(culturalRaw) : { year: null, place: null }

  return {
    sourceUrl,
    originYear: year,
    originPlace: place,
    stylisticOrigins: extractLinkNames(extractFieldRaw(infobox, 'stylistic_origins') ?? ''),
    subgenres: extractLinkNames(extractFieldRaw(infobox, 'subgenres') ?? ''),
    derivatives: extractLinkNames(extractFieldRaw(infobox, 'derivatives') ?? ''),
  }
}

export async function searchWikipediaGenre(name: string): Promise<WikipediaGenreInfo | null> {
  for (const lang of ['ja', 'en'] as const) {
    const fetched = await fetchWikitext(lang, name)
    if (!fetched) continue
    const sourceUrl = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(fetched.resolvedTitle.replace(/ /g, '_'))}`
    const info = parseGenreInfobox(fetched.wikitext, sourceUrl)
    if (info) return info
  }
  return null
}
