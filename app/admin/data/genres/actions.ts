'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'

function redirectWith(result: 'success' | 'error', message: string) {
  redirect(`/admin/data/genres?${result}=${encodeURIComponent(message)}`)
}

export async function createGenre(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const originYearRaw = String(formData.get('origin_year') ?? '').trim()

  if (!name) {
    redirectWith('error', 'ジャンル名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('genre').insert({
    name,
    origin_year: originYearRaw ? Number(originYearRaw) : null,
  })

  if (error) {
    redirectWith('error', `ジャンルの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/genres')
  redirectWith('success', `ジャンル「${name}」を登録しました。`)
}

export async function linkArtistGenre(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')
  const genreId = String(formData.get('genre_id') ?? '')

  if (!artistId || !genreId) {
    redirectWith('error', 'アーティストとジャンルを選択してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('artist_genre').upsert({ artist_id: artistId, genre_id: genreId })

  if (error) {
    redirectWith('error', `ジャンルの紐付けに失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/genres')
  revalidatePath('/relations')
  redirectWith('success', 'アーティストにジャンルを紐付けました。')
}
