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
    .update({
      origin_latitude: latitude,
      origin_longitude: longitude,
      // 座標を修正した場合、それまでに解決済みの国/州地域/市区町村コードは
      // 古い座標に基づいたものである可能性があるため無効化し、
      // バックフィルスクリプトの次回実行で再解決させる。
      origin_country_code: null,
      origin_region_code: null,
      origin_muni_code: null,
    })
    .eq('id', artistId)

  if (error) {
    redirectWith(artistId, 'error', `座標の保存に失敗しました: ${error.message}`)
  }

  revalidatePath(`/admin/data/artists/${artistId}/edit`)
  redirectWith(artistId, 'success', '座標を保存しました。')
}

/** Wikidataに座標が無い/該当データが無いアーティスト向けに、住所・地名(Nominatim)
 * から座標を取り込む。取得できたprefecture/cityがあれば合わせて保存する */
export async function importOriginCoordinatesFromAddress(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')
  const latitudeRaw = formData.get('latitude')
  const longitudeRaw = formData.get('longitude')
  const prefectureOrState = String(formData.get('prefecture_or_state') ?? '').trim()
  const city = String(formData.get('city') ?? '').trim()

  if (!artistId || latitudeRaw === null || longitudeRaw === null) {
    redirect('/admin/data')
  }

  const latitude = Number(latitudeRaw)
  const longitude = Number(longitudeRaw)

  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    redirect('/admin/data')
  }

  const supabase = createAdminClient()
  const { data: existingArtist } = await supabase
    .from('artist')
    .select('origin_prefecture, hometown_city')
    .eq('id', artistId)
    .maybeSingle()

  const { error } = await supabase
    .from('artist')
    .update({
      origin_latitude: latitude,
      origin_longitude: longitude,
      // 既に手動設定済みの値は上書きしない(空のときだけ埋める)
      origin_prefecture: existingArtist?.origin_prefecture ?? (prefectureOrState || null),
      hometown_city: existingArtist?.hometown_city ?? (city || null),
      // 座標を修正した場合、それまでに解決済みの国/州地域/市区町村コードは
      // 古い座標に基づいたものである可能性があるため無効化し、
      // バックフィルスクリプトの次回実行で再解決させる。
      origin_country_code: null,
      origin_region_code: null,
      origin_muni_code: null,
    })
    .eq('id', artistId)

  if (error) {
    redirectWith(artistId, 'error', `座標の保存に失敗しました: ${error.message}`)
  }

  revalidatePath(`/admin/data/artists/${artistId}/edit`)
  redirectWith(artistId, 'success', '座標を保存しました。')
}
