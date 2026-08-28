'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'

function redirectWith(trackId: string, result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/tracks/${trackId}/co-artists?${result}=${encodeURIComponent(message)}`)
}

/** トラックに追加アーティストを紐付ける(album_artistのトラック版)。
 * 「GENERATIONS VS THE RAMPAGE」のような対等なコラボ曲を、代表アーティスト
 * (track.artist_id、オムニバス盤収録曲では"Various Artists"になりがち)だけでなく
 * 実際の演者両方に正しく紐付けるために使う。billing_orderは代表アーティストが
 * 暗黙に位置1を占めるものとして、既存のtrack_artist行数+2から採番する。 */
export async function linkTrackArtist(formData: FormData) {
  const trackId = String(formData.get('track_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')
  const role = String(formData.get('role') ?? '')

  if (!trackId) {
    redirect('/admin/data')
  }
  if (!artistId || (role !== 'featured' && role !== 'main')) {
    redirectWith(trackId, 'error', 'アーティストと関係性を選択してください。')
  }

  const supabase = createAdminClient()

  const { data: track } = await supabase.from('track').select('artist_id').eq('id', trackId).single()
  if (!track) {
    redirectWith(trackId, 'error', 'トラックが見つかりませんでした。')
  }
  if (track!.artist_id === artistId) {
    redirectWith(trackId, 'error', 'そのアーティストは既に代表アーティストとして登録されています。')
  }

  const { count } = await supabase
    .from('track_artist')
    .select('id', { count: 'exact', head: true })
    .eq('track_id', trackId)

  const { error } = await supabase.from('track_artist').insert({
    track_id: trackId,
    artist_id: artistId,
    role,
    billing_order: (count ?? 0) + 2,
  })

  if (error) {
    if (error.code === '23505') {
      redirectWith(trackId, 'error', 'そのアーティストは既に紐付け済みです。')
    }
    redirectWith(trackId, 'error', `紐付けに失敗しました: ${error.message}`)
  }

  revalidatePath(`/admin/data/tracks/${trackId}/co-artists`)
  revalidatePath(`/tracks/${trackId}`)
  revalidatePath(`/artists/${artistId}`)
  redirectWith(trackId, 'success', '追加アーティストを紐付けました。')
}

export async function unlinkTrackArtist(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const trackId = String(formData.get('track_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')

  if (!id || !trackId) {
    redirect('/admin/data')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('track_artist').delete().eq('id', id).eq('track_id', trackId)

  if (error) {
    redirectWith(trackId, 'error', `削除に失敗しました: ${error.message}`)
  }

  revalidatePath(`/admin/data/tracks/${trackId}/co-artists`)
  revalidatePath(`/tracks/${trackId}`)
  if (artistId) revalidatePath(`/artists/${artistId}`)
  redirectWith(trackId, 'success', '紐付けを解除しました。')
}
