const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

// <meta property="og:image" content="..."> を属性順序に関わらず拾う
export function extractOgImage(html: string): string | null {
  const metaTagMatch = html.match(/<meta\s+[^>]*property=["']og:image["'][^>]*>/i)
  if (!metaTagMatch) return null

  const contentMatch = metaTagMatch[0].match(/content=["']([^"']+)["']/i)
  if (!contentMatch) return null

  return decodeHtmlEntities(contentMatch[1])
}

/**
 * 任意のURLのページを取得し、og:imageメタタグから画像URLを取得する。
 * NME/Fender/Spotify等、キュレーションコンテンツの出典サイトはAPIを持たないため、
 * 公開ページのOGPメタタグをスクレイピングする(非公式な手法)。
 * 取得できない場合はnullを返すので、呼び出し側は失敗を許容すること。
 */
export async function fetchOgImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null

    const html = await res.text()
    return extractOgImage(html)
  } catch {
    return null
  }
}
