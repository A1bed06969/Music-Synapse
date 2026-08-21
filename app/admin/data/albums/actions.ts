'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'

function redirectWith(albumId: string, result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/albums/${albumId}/co-artists?${result}=${encodeURIComponent(message)}`)
}

/** アルバムに追加アーティストを紐付ける。既に代表アーティスト(album.artist_id)と
 * 同じ場合や、既に紐付け済み(UNIQUE制約違反)の場合はエラーメッセージを返す。
 * billing_orderは代表アーティストが暗黙に位置1を占めるものとして、
 * 既存のalbum_artist行数+2から採番する。 */
export async function linkAlbumArtist(formData: FormData) {
  const albumId = String(formData.get('album_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')
  const role = String(formData.get('role') ?? '')

  if (!albumId || !artistId || (role !== 'featured' && role !== 'main')) {
    redirect('/admin/data')
  }

  const supabase = createAdminClient()

  const { data: album } = await supabase.from('album').select('artist_id').eq('id', albumId).single()
  if (!album) {
    redirectWith(albumId, 'error', 'アルバムが見つかりませんでした。')
  }
  if (album!.artist_id === artistId) {
    redirectWith(albumId, 'error', 'そのアーティストは既に代表アーティストとして登録されています。')
  }

  const { count } = await supabase
    .from('album_artist')
    .select('id', { count: 'exact', head: true })
    .eq('album_id', albumId)

  const { error } = await supabase.from('album_artist').insert({
    album_id: albumId,
    artist_id: artistId,
    role,
    billing_order: (count ?? 0) + 2,
  })

  if (error) {
    if (error.code === '23505') {
      redirectWith(albumId, 'error', 'そのアーティストは既に紐付け済みです。')
    }
    redirectWith(albumId, 'error', `紐付けに失敗しました: ${error.message}`)
  }

  revalidatePath(`/admin/data/albums/${albumId}/co-artists`)
  revalidatePath(`/albums/${albumId}`)
  revalidatePath(`/artists/${artistId}`)
  redirectWith(albumId, 'success', '追加アーティストを紐付けました。')
}

export async function unlinkAlbumArtist(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const albumId = String(formData.get('album_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')

  if (!id || !albumId) {
    redirect('/admin/data')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('album_artist').delete().eq('id', id)

  if (error) {
    redirectWith(albumId, 'error', `削除に失敗しました: ${error.message}`)
  }

  revalidatePath(`/admin/data/albums/${albumId}/co-artists`)
  revalidatePath(`/albums/${albumId}`)
  if (artistId) revalidatePath(`/artists/${artistId}`)
  redirectWith(albumId, 'success', '紐付けを解除しました。')
}
