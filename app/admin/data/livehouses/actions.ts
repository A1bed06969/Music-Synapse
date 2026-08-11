'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'

export async function importLivehouse(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const address = String(formData.get('address') ?? '').trim()
  const url = String(formData.get('url') ?? '').trim()
  const hours = String(formData.get('hours') ?? '').trim()
  const country = String(formData.get('country') ?? '').trim()
  const prefectureOrState = String(formData.get('prefecture_or_state') ?? '').trim()
  const city = String(formData.get('city') ?? '').trim()
  const latitudeRaw = formData.get('latitude')
  const longitudeRaw = formData.get('longitude')

  if (!name || latitudeRaw === null || longitudeRaw === null) {
    redirect('/admin/data/livehouses')
  }

  const latitude = Number(latitudeRaw)
  const longitude = Number(longitudeRaw)

  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    redirect('/admin/data/livehouses')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('livehouse').insert({
    name,
    address: address || null,
    url: url || null,
    hours: hours || null,
    country: country || null,
    prefecture_or_state: prefectureOrState || null,
    city: city || null,
    latitude,
    longitude,
    source: 'nominatim',
  })

  if (error) {
    redirect(`/admin/data/livehouses?error=${encodeURIComponent(`保存に失敗しました: ${error.message}`)}`)
  }

  revalidatePath('/admin/data/livehouses')
  revalidatePath('/map')
  redirect(`/admin/data/livehouses?success=${encodeURIComponent(`「${name}」を登録しました。`)}`)
}
