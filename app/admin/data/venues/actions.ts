'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'

export async function importVenueLocation(formData: FormData) {
  const venueName = String(formData.get('venue_name') ?? '')
  const latitudeRaw = formData.get('latitude')
  const longitudeRaw = formData.get('longitude')

  if (!venueName || latitudeRaw === null || longitudeRaw === null) {
    redirect('/admin/data/venues')
  }

  const latitude = Number(latitudeRaw)
  const longitude = Number(longitudeRaw)

  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    redirect('/admin/data/venues')
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('venue_location')
    .upsert(
      { venue_name: venueName, latitude, longitude, source: 'nominatim' },
      { onConflict: 'venue_name', ignoreDuplicates: true }
    )

  if (error) {
    redirect(`/admin/data/venues?error=${encodeURIComponent(`保存に失敗しました: ${error.message}`)}`)
  }

  revalidatePath('/admin/data/venues')
  redirect(`/admin/data/venues?success=${encodeURIComponent(`「${venueName}」の座標を保存しました。`)}`)
}
