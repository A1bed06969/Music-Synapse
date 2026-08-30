'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchAlbumById } from '@/utils/itunes'
import { registerAlbumFromSearch } from '@/app/admin/import/search/actions'

export type LinkResult = { success: boolean; message: string; albumId?: string }

/** コラボ/feat.クレジットの作品は参加アーティストそれぞれのカタログに同じ
 * apple_music_album_idが重複して存在しうるため、artist_idも合わせて絞り込む
 * (HRPPの手動マッチングで見つかった同種の不具合と同じ対策)。 */
async function findRegisteredAlbum(
  supabase: ReturnType<typeof createAdminClient>,
  itunesArtistId: number,
  collectionId: number
) {
  const { data: artist } = await supabase
    .from('artist')
    .select('id')
    .eq('apple_music_artist_id', String(itunesArtistId))
    .maybeSingle()
  if (!artist) return null

  const { data: album } = await supabase
    .from('album')
    .select('id')
    .eq('apple_music_album_id', String(collectionId))
    .eq('artist_id', artist.id)
    .maybeSingle()
  return album
}

/** ディスクガイド確認画面と同じ候補選択UIから、キュレーション企画(ranking_entry)の
 * 最小限スタブ登録(streaming_status: unreleased)を、選んだ候補の実データへ
 * 差し替える。候補は自前DB(実IDそのまま)かApple Music(`itunes:<collectionId>`
 * プレフィックス)のどちらか。 */
export async function linkRankingEntryCandidate(
  rankingId: string,
  entryId: number,
  oldAlbumId: string | null,
  oldArtistId: string | null,
  candidateId: string
): Promise<LinkResult> {
  const supabase = createAdminClient()

  let newAlbumId: string

  if (candidateId.startsWith('itunes:')) {
    const collectionId = Number(candidateId.slice('itunes:'.length))
    const itunesAlbum = await fetchAlbumById(collectionId)
    if (!itunesAlbum) {
      return { success: false, message: 'iTunesで見つかりませんでした。' }
    }

    let album = await findRegisteredAlbum(supabase, itunesAlbum.artistId, collectionId)
    if (!album) {
      const registerResult = await registerAlbumFromSearch(collectionId)
      if (!registerResult.success) {
        return { success: false, message: `カタログ登録に失敗しました: ${registerResult.message}` }
      }
      album = await findRegisteredAlbum(supabase, itunesAlbum.artistId, collectionId)
    }
    if (!album) {
      return { success: false, message: '登録後もアルバムが見つかりませんでした。' }
    }
    newAlbumId = album.id
  } else {
    newAlbumId = candidateId
  }

  const { error } = await supabase.from('ranking_entry').update({ album_id: newAlbumId }).eq('id', entryId)
  if (error) {
    return { success: false, message: `更新に失敗しました: ${error.message}` }
  }

  if (oldAlbumId && oldAlbumId !== newAlbumId) {
    await supabase.from('album').delete().eq('id', oldAlbumId)
  }
  if (oldArtistId) {
    const { data: remainingAlbums } = await supabase.from('album').select('id').eq('artist_id', oldArtistId).limit(1)
    const { data: remainingTracks } = await supabase.from('track').select('id').eq('artist_id', oldArtistId).limit(1)
    if ((remainingAlbums?.length ?? 0) === 0 && (remainingTracks?.length ?? 0) === 0) {
      await supabase.from('artist').delete().eq('id', oldArtistId)
    }
  }

  revalidatePath(`/admin/data/curation/${rankingId}/match`)
  revalidatePath('/admin/data/curation')
  revalidatePath(`/media/features/${rankingId}`)

  return { success: true, message: '登録しました。', albumId: newAlbumId }
}
