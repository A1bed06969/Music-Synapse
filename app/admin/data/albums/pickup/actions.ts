'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'

function redirectWith(result: 'success' | 'error', message: string) {
  redirect(`/admin/data/albums/pickup?${result}=${encodeURIComponent(message)}`)
}

export async function createAlbumPickup(formData: FormData) {
  const albumId = String(formData.get('album_id') ?? '')
  const blurb = String(formData.get('blurb') ?? '').trim()

  if (!albumId) {
    redirectWith('error', 'アルバムを選択してください。')
  }

  const supabase = createAdminClient()
  const { data: existing } = await supabase
    .from('album_pickup')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = (existing?.sort_order ?? -1) + 1

  const { error } = await supabase.from('album_pickup').insert({ album_id: albumId, blurb: blurb || null, sort_order: nextOrder })

  if (error) {
    redirectWith('error', `登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/albums/pickup')
  revalidatePath('/albums/calendar')
  redirectWith('success', 'ピックアップに追加しました。')
}

export async function deleteAlbumPickup(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  if (!id) {
    redirectWith('error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('album_pickup').delete().eq('id', id)

  if (error) {
    redirectWith('error', `削除に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/albums/pickup')
  revalidatePath('/albums/calendar')
  redirectWith('success', '削除しました。')
}
