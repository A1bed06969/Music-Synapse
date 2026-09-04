'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchImageUrl } from '@/utils/wikidata'
import { fetchAppleMusicArtistImage } from '@/utils/appleMusicImage'

const MAX_PER_RUN = 30

export async function runBulkImageUpdate() {
  const supabase = createAdminClient()

  const { data: wikidataLinks } = await supabase
    .from('artist_external_link')
    .select('artist_id, url, artist:artist_id(id, name, image_url)')
    .eq('link_type', 'wikidata')

  const eligibleByArtistId = new Map<string, { artistId: string; name: string; url: string }>()
  for (const l of wikidataLinks ?? []) {
    const artist = Array.isArray(l.artist) ? l.artist[0] : l.artist
    if (!artist || artist.image_url != null) continue
    const artistId = artist.id as string
    // 同一アーティストに複数のWikidataリンクがある場合、最初の1件のみを採用する(二重処理防止)
    if (eligibleByArtistId.has(artistId)) continue
    eligibleByArtistId.set(artistId, { artistId, name: artist.name as string, url: l.url as string })
  }
  const eligible = Array.from(eligibleByArtistId.values())
  const remaining = Math.max(0, eligible.length - MAX_PER_RUN)
  const toProcess = eligible.slice(0, MAX_PER_RUN)

  let updated = 0
  let notFound = 0
  let failed = 0

  for (const { artistId, name, url } of toProcess) {
    const qidMatch = url.match(/\/(Q\d+)$/)
    if (!qidMatch) {
      failed += 1
      continue
    }
    const qid = qidMatch[1]

    let imageUrl: string | null
    try {
      imageUrl = await fetchImageUrl(qid)
    } catch (err) {
      console.error(`Wikidata画像取得に失敗しました(${name}):`, err)
      failed += 1
      continue
    }

    if (!imageUrl) {
      notFound += 1
      continue
    }

    const { error } = await supabase.from('artist').update({ image_url: imageUrl }).eq('id', artistId)
    if (error) {
      console.error(`画像の保存に失敗しました(${name}):`, error)
      failed += 1
      continue
    }
    updated += 1
  }

  revalidatePath('/admin/data/artists/images')
  revalidatePath('/artists')
  revalidatePath('/tracks')

  const message =
    `更新${updated}件・画像なし${notFound}件・失敗${failed}件` +
    (remaining > 0 ? `、残り${remaining}件は次回の実行で処理されます` : '')
  if (updated === 0 && failed > 0) {
    redirect(`/admin/data/artists/images?error=${encodeURIComponent(message)}`)
  }
  redirect(`/admin/data/artists/images?success=${encodeURIComponent(message)}`)
}

/** Apple Music紐付け済み(apple_music_artist_id)だが画像が未設定のアーティストを対象に、
 * 公式アーティストページのog:imageから画像を取得して反映する
 * (fetchAppleMusicArtistImage、utils/appleMusicImage.tsのコメント参照)。
 * Wikidata版と違い、独立したHTTPフェッチのため並行実行で1件ずつの待ち時間を吸収する。 */
export async function runBulkAppleMusicImageUpdate() {
  const supabase = createAdminClient()

  const { data: artists } = await supabase
    .from('artist')
    .select('id, name, apple_music_artist_id, apple_music_country')
    .not('apple_music_artist_id', 'is', null)
    .is('image_url', null)
    .limit(MAX_PER_RUN)

  const toProcess = artists ?? []

  let updated = 0
  let notFound = 0
  let failed = 0

  const results = await Promise.all(
    toProcess.map(async (artist) => {
      try {
        const imageUrl = await fetchAppleMusicArtistImage(
          artist.apple_music_artist_id as string,
          (artist.apple_music_country as string) || 'JP'
        )
        return { artist, imageUrl }
      } catch (err) {
        console.error(`Apple Music画像取得に失敗しました(${artist.name}):`, err)
        return { artist, imageUrl: null, error: true }
      }
    })
  )

  for (const { artist, imageUrl, error: fetchFailed } of results) {
    if (fetchFailed) {
      failed += 1
      continue
    }
    if (!imageUrl) {
      notFound += 1
      continue
    }
    const { error } = await supabase.from('artist').update({ image_url: imageUrl }).eq('id', artist.id)
    if (error) {
      console.error(`画像の保存に失敗しました(${artist.name}):`, error)
      failed += 1
      continue
    }
    updated += 1
  }

  revalidatePath('/admin/data/artists/images')
  revalidatePath('/artists')
  revalidatePath('/tracks')

  const message = `更新${updated}件・画像なし${notFound}件・失敗${failed}件`
  if (updated === 0 && failed > 0) {
    redirect(`/admin/data/artists/images?error=${encodeURIComponent(message)}`)
  }
  redirect(`/admin/data/artists/images?success=${encodeURIComponent(message)}`)
}
