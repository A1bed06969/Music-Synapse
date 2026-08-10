'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchOriginCoordinates } from '@/utils/wikidata'

const MAX_PER_RUN = 30

export async function runBulkOriginUpdate() {
  const supabase = createAdminClient()

  const { data: wikidataLinks } = await supabase
    .from('artist_external_link')
    .select('artist_id, url, artist:artist_id(id, name, origin_latitude)')
    .eq('link_type', 'wikidata')

  const eligibleByArtistId = new Map<string, { artistId: string; name: string; url: string }>()
  for (const l of wikidataLinks ?? []) {
    const artist = Array.isArray(l.artist) ? l.artist[0] : l.artist
    if (!artist || artist.origin_latitude != null) continue
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

    let coords
    try {
      coords = await fetchOriginCoordinates(qid)
    } catch (err) {
      console.error(`Wikidata座標取得に失敗しました(${name}):`, err)
      failed += 1
      continue
    }

    if (!coords) {
      notFound += 1
      continue
    }

    const { error } = await supabase
      .from('artist')
      .update({ origin_latitude: coords.latitude, origin_longitude: coords.longitude })
      .eq('id', artistId)
    if (error) {
      console.error(`座標の保存に失敗しました(${name}):`, error)
      failed += 1
      continue
    }
    updated += 1
  }

  revalidatePath('/admin/data/artists/geo')

  const message =
    `更新${updated}件・座標データなし${notFound}件・失敗${failed}件` +
    (remaining > 0 ? `、残り${remaining}件は次回の実行で処理されます` : '')
  if (updated === 0 && failed > 0) {
    redirect(`/admin/data/artists/geo?error=${encodeURIComponent(message)}`)
  }
  redirect(`/admin/data/artists/geo?success=${encodeURIComponent(message)}`)
}
