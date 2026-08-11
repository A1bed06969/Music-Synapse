'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchImageUrl } from '@/utils/wikidata'

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
