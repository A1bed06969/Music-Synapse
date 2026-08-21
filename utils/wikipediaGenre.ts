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
  // 「19世紀後半」のように諸説あり/年が特定されていない場合、originYearには
  // 年表の並び替え専用の概算値(下のparseCenturyExpression参照)を入れ、
  // originYearLabelに元の表記をそのまま残す。表示側はoriginYearLabelがあれば
  // そちらを優先し、無ければoriginYearをそのまま「◯◯年」として表示する。
  originYearLabel: string | null
  originPlace: string | null
  stylisticOrigins: string[]
  subgenres: string[]
  derivatives: string[]
}

async function fetchWikitext(
  lang: 'ja' | 'en',
  title: string
): Promise<{ wikitext: string; resolvedTitle: string } | null> {
  try {
    const url = `https://${lang}.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&format=json&prop=wikitext&section=0&redirects=1`
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) return null
    const data = await res.json()
    if (data.error) return null
    const wikitext = data.parse?.wikitext?.['*']
    const resolvedTitle = data.parse?.title
    if (!wikitext || !resolvedTitle) return null
    return { wikitext, resolvedTitle }
  } catch {
    return null
  }
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

// <ref>タグ(出典)は表示用の名前ではないため、フィールドの生テキストから
// 取り除いておく。自己終了型<ref .../>とペア型<ref ...>...</ref>の両方に対応。
function stripRefTags(text: string): string {
  return text.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
}

function extractFieldRaw(infobox: string, field: string): string | null {
  const re = new RegExp(`\\|\\s*${field}\\s*=([\\s\\S]*?)(?=\\n\\s*\\|\\s*[a-zA-Z_]+\\s*=|\\n\\}\\}\\s*$)`, 'i')
  const m = infobox.match(re)
  return m ? stripRefTags(m[1].trim()) : null
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
    const target = m[1].trim()
    if (/^#/.test(target) || /^(File|ファイル|Category|カテゴリ):/i.test(target)) continue
    const name = (m[2] ?? m[1]).trim()
    if (name) names.push(name)
  }
  return names
}

// 西暦4桁が特定できない場合(諸説ある古いジャンル等でよく見られる)、「19世紀」
// 「19世紀後半」のような世紀表記を年表の並び替え用に概算年へ変換する。元の表記
//自体はlabelとしてそのまま保持し、表示は概算値ではなく元の表記を優先させる。
const JA_CENTURY_OFFSET: [RegExp, number][] = [
  [/初頭|初め/, 10],
  [/前半/, 25],
  [/半ば|中頃|中盤/, 50],
  [/後半/, 75],
  [/末/, 90],
]

function parseJaCentury(text: string): { year: number; label: string } | null {
  const m = text.match(/(\d{1,2})世紀(初頭|初め|前半|半ば|中頃|中盤|後半|末)?/)
  if (!m) return null
  const century = parseInt(m[1], 10)
  const base = (century - 1) * 100
  let offset = 50
  if (m[2]) {
    const found = JA_CENTURY_OFFSET.find(([re]) => re.test(m[2]!))
    if (found) offset = found[1]
  }
  return { year: base + offset, label: m[0] }
}

const EN_CENTURY_OFFSET: [RegExp, number][] = [
  [/early/i, 10],
  [/mid/i, 50],
  [/late/i, 75],
]

function parseEnCentury(text: string): { year: number; label: string } | null {
  const m = text.match(/(early|mid|late)?[\s-]*(\d{1,2})(?:st|nd|rd|th)[\s-]century/i)
  if (!m) return null
  const century = parseInt(m[2], 10)
  const base = (century - 1) * 100
  let offset = 50
  if (m[1]) {
    const found = EN_CENTURY_OFFSET.find(([re]) => re.test(m[1]!))
    if (found) offset = found[1]
  }
  return { year: base + offset, label: m[0].trim() }
}

function parseCenturyExpression(text: string): { year: number; label: string } | null {
  return parseJaCentury(text) ?? parseEnCentury(text)
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
function extractCulturalOrigin(fieldRaw: string): { year: number | null; yearLabel: string | null; place: string | null } {
  const countryNames: string[] = []
  const templateRe = /\{\{\s*([A-Za-z]{2,5})\s*\}\}/g
  let tm: RegExpExecArray | null
  while ((tm = templateRe.exec(fieldRaw))) {
    const jaName = COUNTRY_TEMPLATE_JA[tm[1].toUpperCase()]
    if (jaName) countryNames.push(jaName)
  }

  const linkNames = extractLinkNames(fieldRaw)
  const yearLink = linkNames.find((n) => /^\d{4}/.test(n))
  const placeFromLinks = linkNames.filter((n) => !/^\d{4}/.test(n) && !parseCenturyExpression(n))

  const plainText = fieldRaw
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, d) => d ?? a)
  const plainYearMatch = plainText.match(/\d{4}/)

  let year: number | null = null
  let yearLabel: string | null = null

  if (yearLink) {
    year = parseInt(yearLink.slice(0, 4), 10)
  } else if (plainYearMatch) {
    year = parseInt(plainYearMatch[0], 10)
  } else {
    // 西暦4桁が見つからない場合、「19世紀」「19世紀後半」のような世紀表記を試す
    const century =
      linkNames.map(parseCenturyExpression).find((c): c is NonNullable<typeof c> => c !== null) ??
      parseCenturyExpression(plainText)
    if (century) {
      year = century.year
      yearLabel = century.label
    }
  }

  const placeParts = [...countryNames, ...placeFromLinks]
  if (placeParts.length === 0) {
    const withoutYear = plainText
      .replace(/\d{4}s?/, '')
      .replace(/\d{1,2}世紀(初頭|初め|前半|半ば|中頃|中盤|後半|末)?/, '')
      .replace(/(early|mid|late)?[\s-]*\d{1,2}(?:st|nd|rd|th)[\s-]century/i, '')
      .replace(/^[,、*\s]+|[,、*\s]+$/g, '')
      .trim()
    if (withoutYear) placeParts.push(withoutYear)
  }

  return { year, yearLabel, place: placeParts.length > 0 ? placeParts.join(', ') : null }
}

export function parseGenreInfobox(wikitext: string, sourceUrl: string): WikipediaGenreInfo | null {
  const infobox = extractInfobox(wikitext)
  if (!infobox) return null

  const culturalRaw = extractFieldRaw(infobox, 'cultural_origins')
  const { year, yearLabel, place } = culturalRaw
    ? extractCulturalOrigin(culturalRaw)
    : { year: null, yearLabel: null, place: null }

  return {
    sourceUrl,
    originYear: year,
    originYearLabel: yearLabel,
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
