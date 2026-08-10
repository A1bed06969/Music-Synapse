'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchOriginCoordinates } from '@/utils/wikidata'

export async function runBulkOriginUpdate() {
  const supabase = createAdminClient()

  const { data: wikidataLinks } = await supabase
    .from('artist_external_link')
    .select('artist_id, url, artist:artist_id(id, name, origin_latitude)')
    .eq('link_type', 'wikidata')

  const eligible = (wikidataLinks ?? [])
    .map((l) => {
      const artist = Array.isArray(l.artist) ? l.artist[0] : l.artist
      if (!artist || artist.origin_latitude != null) return null
      return { artistId: artist.id as string, name: artist.name as string, url: l.url as string }
    })
    .filter((v): v is { artistId: string; name: string; url: string } => v !== null)

  let updated = 0
  let notFound = 0
  let failed = 0

  for (const { artistId, name, url } of eligible) {
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

  const message = `更新${updated}件・座標データなし${notFound}件・失敗${failed}件`
  if (updated === 0 && failed > 0) {
    redirect(`/admin/data/artists/geo?error=${encodeURIComponent(message)}`)
  }
  redirect(`/admin/data/artists/geo?success=${encodeURIComponent(message)}`)
}
