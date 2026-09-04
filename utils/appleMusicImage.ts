import { searchArtist } from '@/utils/itunes'

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
function extractOgImage(html: string): string | null {
  const metaTagMatch = html.match(/<meta\s+[^>]*property=["']og:image["'][^>]*>/i)
  if (!metaTagMatch) return null

  const contentMatch = metaTagMatch[0].match(/content=["']([^"']+)["']/i)
  if (!contentMatch) return null

  return decodeHtmlEntities(contentMatch[1])
}

// URL末尾のサイズ指定(例: /1200x630cw.png)を600x600bb.pngに置換する。
// パターンに合わない場合は元のURLをそのまま返す。
function toSquareUrl(url: string): string {
  return url.replace(/\/\d+x\d+[a-z]{2}\.(jpg|jpeg|png|webp)(\?.*)?$/i, '/600x600bb.$1$2')
}

/**
 * Apple Music公式APIはアーティスト画像(artwork)の取得に「Insufficient Permissions」を
 * 返すため、代わりに公開アーティストページのog:imageメタタグから画像URLを取得する
 * (非公式な手法)。取得できない場合はnullを返すので、呼び出し側は失敗を許容すること。
 */
export async function fetchAppleMusicArtistImage(appleMusicArtistId: string, country = 'jp'): Promise<string | null> {
  const url = `https://music.apple.com/${country.toLowerCase()}/artist/${appleMusicArtistId}`

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'ja-JP,ja;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null

    const html = await res.text()
    const imageUrl = extractOgImage(html)
    return imageUrl ? toSquareUrl(imageUrl) : null
  } catch {
    return null
  }
}

/**
 * apple_music_artist_idを持たないアーティスト(MusicBrainzの"member of band"経由で
 * 名前だけ登録されたバンドメンバー等)向けに、名前でiTunesを検索して画像を解決する。
 * 同名・類似名の別人を拾うリスクがあるため、検索結果の中に正規化後の名前が完全一致する
 * 候補がちょうど1件だけある場合のみ採用する(それ以外は誤爆防止のためnullを返す)
 */
export async function resolveArtistImageByName(artistName: string): Promise<string | null> {
  const normalize = (s: string) => s.trim().toLowerCase()

  let candidates
  try {
    candidates = await searchArtist(artistName)
  } catch {
    return null
  }

  const exactMatches = candidates.filter((c) => normalize(c.artistName) === normalize(artistName))
  if (exactMatches.length !== 1) return null

  return fetchAppleMusicArtistImage(String(exactMatches[0].artistId))
}
