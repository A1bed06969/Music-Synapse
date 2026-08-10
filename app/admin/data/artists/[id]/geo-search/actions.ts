'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'

function redirectWith(artistId: string, result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/artists/${artistId}/geo-search?${result}=${encodeURIComponent(message)}`)
}

export async function importOriginCoordinates(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')
  const latitudeRaw = formData.get('latitude')
  const longitudeRaw = formData.get('longitude')

  if (!artistId || latitudeRaw === null || longitudeRaw === null) {
    redirect('/admin/data')
  }

  const latitude = Number(latitudeRaw)
  const longitude = Number(longitudeRaw)

  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    redirect('/admin/data')
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('artist')
    .update({ origin_latitude: latitude, origin_longitude: longitude })
    .eq('id', artistId)

  if (error) {
    redirectWith(artistId, 'error', `座標の保存に失敗しました: ${error.message}`)
  }

  revalidatePath(`/admin/data/artists/${artistId}/edit`)
  redirectWith(artistId, 'success', '座標を保存しました。')
}
