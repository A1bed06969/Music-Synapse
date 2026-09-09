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
