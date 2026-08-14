/**
 * scripts/test-apple-music-artist-image.tsで検証したApple Music公開アーティスト
 * ページのog:imageスクレイピングを使い、image_url未設定の全アーティストに
 * 画像を一括登録する。Wikidata経由の一括更新(app/admin/data/artists/images)と
 * 同じ方針で、既にimage_urlが設定済みのアーティストは上書きしない。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/backfill-apple-music-artist-images.ts
 */
import { createAdminClient } from '@/utils/Supabase/admin'

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

function extractOgImage(html: string): string | null {
  const metaTagMatch = html.match(/<meta\s+[^>]*property=["']og:image["'][^>]*>/i)
  if (!metaTagMatch) return null

  const contentMatch = metaTagMatch[0].match(/content=["']([^"']+)["']/i)
  if (!contentMatch) return null

  return decodeHtmlEntities(contentMatch[1])
}

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
    return { ok: false, reason: 'og:imageタグが見つかりませんでした' }
  }

  return { ok: true, imageUrl }
}

async function main() {
  const supabase = createAdminClient()

  const { data: artists, error } = await supabase
    .from('artist')
    .select('id, name, apple_music_artist_id, image_url')
    .not('apple_music_artist_id', 'is', null)
    .neq('apple_music_artist_id', '')
    .is('image_url', null)

  if (error) {
    console.error('アーティスト取得に失敗しました:', error.message)
    process.exit(1)
  }

  const rows = (artists ?? []) as (ArtistRow & { image_url: string | null })[]

  if (rows.length === 0) {
    console.log('image_url未設定でapple_music_artist_idを持つアーティストはいません。')
    return
  }

  console.log(`対象: ${rows.length}件\n`)

  let updated = 0
  let notFound = 0
  let failed = 0

  for (const [index, artist] of rows.entries()) {
    console.log(`[${index + 1}/${rows.length}] ${artist.name}`)

    const result = await fetchOgImage(artist.apple_music_artist_id)

    if (!result.ok) {
      console.log(`  ❌ 取得失敗: ${result.reason}`)
      notFound += 1
    } else {
      const squareUrl = toSquareUrl(result.imageUrl)
      const { error: updateError } = await supabase.from('artist').update({ image_url: squareUrl }).eq('id', artist.id)
      if (updateError) {
        console.log(`  ❌ 保存失敗: ${updateError.message}`)
        failed += 1
      } else {
        console.log(`  ✅ 登録: ${squareUrl}`)
        updated += 1
      }
    }

    if (index < rows.length - 1) {
      await sleep(REQUEST_INTERVAL_MS)
    }
  }

  console.log('\n--- 結果サマリー ---')
  console.log(`登録成功: ${updated}/${rows.length}件`)
  console.log(`画像取得失敗: ${notFound}/${rows.length}件`)
  console.log(`DB保存失敗: ${failed}/${rows.length}件`)
}

main()
