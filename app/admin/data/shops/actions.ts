'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'

export async function importRecordShop(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const address = String(formData.get('address') ?? '').trim()
  const officialSiteUrl = String(formData.get('official_site_url') ?? '').trim()
  const hours = String(formData.get('hours') ?? '').trim()
  const snsXUrl = String(formData.get('sns_x_url') ?? '').trim()
  const snsInstagramUrl = String(formData.get('sns_instagram_url') ?? '').trim()
  const country = String(formData.get('country') ?? '').trim()
  const prefectureOrState = String(formData.get('prefecture_or_state') ?? '').trim()
  const city = String(formData.get('city') ?? '').trim()
  const latitudeRaw = formData.get('latitude')
  const longitudeRaw = formData.get('longitude')
  const geocodeSource = String(formData.get('geocode_source') ?? '') === 'gsi' ? 'gsi' : 'nominatim'

  if (!name || latitudeRaw === null || longitudeRaw === null) {
    redirect('/admin/data/shops')
  }

  const latitude = Number(latitudeRaw)
  const longitude = Number(longitudeRaw)

  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    redirect('/admin/data/shops')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('recordshop').insert({
    name,
    address: address || null,
    official_site_url: officialSiteUrl || null,
    hours: hours || null,
    sns_x_url: snsXUrl || null,
    sns_instagram_url: snsInstagramUrl || null,
    country: country || null,
    prefecture_or_state: prefectureOrState || null,
    city: city || null,
    latitude,
    longitude,
    source: geocodeSource,
  })

  if (error) {
    redirect(`/admin/data/shops?error=${encodeURIComponent(`保存に失敗しました: ${error.message}`)}`)
  }

  revalidatePath('/admin/data/shops')
  revalidatePath('/map')
  redirect(`/admin/data/shops?success=${encodeURIComponent(`「${name}」を登録しました。`)}`)
}
