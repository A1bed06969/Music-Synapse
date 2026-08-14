/**
 * Apple Music公式APIはアーティスト画像(artwork)取得に「Insufficient Permissions」を
 * 返すため、代わりにmusic.apple.comの公開アーティストページのog:imageメタタグから
 * 画像URLを取得できるか検証するテストスクリプト。DBへの保存は行わない。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/test-apple-music-artist-image.ts
 */
import { createAdminClient } from '@/utils/Supabase/admin'

const TEST_LIMIT = 5
const REQUEST_INTERVAL_MS = 1000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

type ArtistRow = {
  id: string
  name: string
  apple_music_artist_id: string
}

type FetchResult = { ok: true; imageUrl: string } | { ok: false; reason: string }

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

// URL末尾のサイズ指定(例: /1200x630bf.jpg)を600x600bb.jpgに置換する。
// パターンに合わない場合は元のURLをそのまま返す。
function toSquareUrl(url: string): string {
  return url.replace(/\/\d+x\d+[a-z]{2}\.(jpg|jpeg|png|webp)(\?.*)?$/i, '/600x600bb.$1$2')
}

async function fetchOgImage(appleMusicArtistId: string): Promise<FetchResult> {
  const url = `https://music.apple.com/jp/artist/${appleMusicArtistId}`

  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'ja-JP,ja;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    })
  } catch (err) {
    return { ok: false, reason: `リクエスト失敗: ${(err as Error).message}` }
  }

  if (!res.ok) {
    return { ok: false, reason: `HTTPエラー: ${res.status} ${res.statusText}` }
  }

  const html = await res.text()
  const imageUrl = extractOgImage(html)
  if (!imageUrl) {
    return { ok: false, reason: 'og:imageタグが見つかりませんでした(ページ構造が変わったか、アーティストページが存在しない可能性)' }
  }

  return { ok: true, imageUrl }
}

async function main() {
  console.log(`Apple Music OGP画像取得テスト(最大${TEST_LIMIT}件)\n`)

  const supabase = createAdminClient()
  const { data: artists, error } = await supabase
    .from('artist')
    .select('id, name, apple_music_artist_id')
    .not('apple_music_artist_id', 'is', null)
    .neq('apple_music_artist_id', '')
    .limit(TEST_LIMIT)

  if (error) {
    console.error('アーティスト取得に失敗しました:', error.message)
    process.exit(1)
  }

  const rows = (artists ?? []) as ArtistRow[]

  if (rows.length === 0) {
    console.log('apple_music_artist_idが設定されたアーティストが見つかりませんでした。')
    return
  }

  console.log(`対象: ${rows.length}件\n`)

  let successCount = 0
  let failureCount = 0

  for (const [index, artist] of rows.entries()) {
    console.log(`[${index + 1}/${rows.length}] ${artist.name} (apple_music_artist_id=${artist.apple_music_artist_id})`)

    const result = await fetchOgImage(artist.apple_music_artist_id)

    if (result.ok) {
      successCount++
      const squareUrl = toSquareUrl(result.imageUrl)
      console.log('  ✅ 成功')
      console.log(`     元URL: ${result.imageUrl}`)
      console.log(`     正方形URL: ${squareUrl}`)
    } else {
      failureCount++
      console.log(`  ❌ 失敗: ${result.reason}`)
    }

    console.log('')

    if (index < rows.length - 1) {
      await sleep(REQUEST_INTERVAL_MS)
    }
  }

  console.log('--- 結果サマリー ---')
  console.log(`成功: ${successCount}/${rows.length}件`)
  console.log(`失敗: ${failureCount}/${rows.length}件`)
}

main()
