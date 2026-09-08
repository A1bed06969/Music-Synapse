// utils/wikipediaArticle.ts
//
// アーティスト紹介文(bio)自動生成のためのWikipediaリード文(冒頭セクション)取得。
// wikitext取得自体はutils/wikipediaGenre.tsのfetchWikitext(冒頭セクションのみを
// action=parse&prop=wikitext&section=0で取得する仕組み)をそのまま再利用し、
// ここではGeminiに渡すための平文化だけを担当する。
//
// wikipediaGenre.tsのfindMatchingClose相当のネスト対応はここでは行わない
// (テンプレートが入れ子でも、生成プロンプトの参考テキストとしては多少の
// 取りこぼしが許容範囲。Geminiには供給テキストに無い情報を書き加えないよう
// 別途指示するため、整形漏れが事実の誤りには直結しない)。
import { fetchWikitext } from './wikipediaGenre.ts'

export function stripWikitextMarkup(wikitext: string): string {
  return wikitext
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
