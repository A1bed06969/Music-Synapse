// utils/wikipediaArticle.ts
//
// アーティスト紹介文(bio)自動生成のためのWikipediaリード文(冒頭セクション)取得。
// wikitext取得自体はutils/wikipediaGenre.tsのfetchWikitext(冒頭セクションのみを
// action=parse&prop=wikitext&section=0で取得する仕組み)をそのまま再利用し、
// ここではGeminiに渡すための平文化だけを担当する。
//
// section=0には常にInfobox(例: {{Infobox musician | ... }})が含まれ、
// その中には{{hlist|...}}のようなテンプレートが入れ子で現れる。以降の
// テンプレート除去(非入れ子対応の正規表現)ではこれを綺麗に消せず、
// 生の`|`やフィールド名が残ってGeminiへのプロンプトを汚してしまうため、
// wikipediaGenre.tsのfindMatchingClose(入れ子対応の波括弧マッチング)を
// 使ってInfobox全体を先に丸ごと除去しておく。
import { fetchWikitext, findMatchingClose } from './wikipediaGenre.ts'

function stripInfobox(wikitext: string): string {
  const match = wikitext.match(/\{\{\s*Infobox\b/i)
  if (!match || match.index === undefined) return wikitext
  const end = findMatchingClose(wikitext, match.index)
  if (end === -1) return wikitext
  return wikitext.slice(0, match.index) + wikitext.slice(end)
}

export function stripWikitextMarkup(wikitext: string): string {
  return stripInfobox(wikitext)
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]|]+)\]\]/g, '$1')
    .replace(/'''''([^']+)'''''/g, '$1')
    .replace(/'''([^']+)'''/g, '$1')
    .replace(/''([^']+)''/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

export async function fetchWikipediaLeadText(lang: 'ja' | 'en', title: string): Promise<string | null> {
  const fetched = await fetchWikitext(lang, title)
  if (!fetched) return null
  const cleaned = stripWikitextMarkup(fetched.wikitext)
  return cleaned.length > 0 ? cleaned : null
}

// section=0(冒頭セクション)だけだと「1990年8月16日生まれ、ロンドンを拠点に
// 活動するシンガーソングライター」のような定義文1文だけで終わる記事が多く
// (実際の経歴・来歴は「略歴」「キャリア」等の後続セクションにある)、
// 紹介文生成のソースとしては薄すぎる(2026-09-20、ユーザー指摘)。
// MediaWikiのextracts APIはセクション境界を跨いで記事本文をプレーンテキスト化
// して返してくれるため、冒頭に留まらず経歴セクションの内容まで自然に含まれる。
// wikitext自前パースが不要になる副次的な利点もある。
export async function fetchWikipediaExtract(
  lang: 'ja' | 'en',
  title: string,
  maxChars = 1800
): Promise<string | null> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&titles=${encodeURIComponent(title)}&exchars=${maxChars}&explaintext=1&redirects=1&format=json`
  const res = await fetch(url, { headers: { 'User-Agent': 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)' } })
  if (!res.ok) return null
  const data = await res.json()
  const pages = data?.query?.pages
  if (!pages) return null
  const page = Object.values(pages)[0] as { extract?: string } | undefined
  const extract = page?.extract?.trim()
  return extract ? extract : null
}
