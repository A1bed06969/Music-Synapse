'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchAlbumById, searchAlbums, parseAppleMusicAlbumUrl } from '@/utils/itunes'
import { registerAlbumFromSearch } from '@/app/admin/import/search/actions'

export type LinkResult = { success: boolean; message: string; albumId?: string }
export type SearchItem = { id: string; label: string; imageUrl?: string }

/** 自動マッチング(タイトル/アーティスト名の一致度)では見つからなかった候補を、
 * 管理者が自分でキーワードを入れて検索できるようにする(HRPPの手動マッチング
 * 検索と同じ考え方)。返り値のidはlinkRankingEntryCandidateへそのまま渡せる
 * `itunes:<collectionId>`形式。 */
export async function searchAppleMusicAlbumsForCuration(query: string): Promise<SearchItem[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  let results
  try {
    results = await searchAlbums(trimmed, 10)
  } catch {
    return []
  }

  return results.map((a) => ({
    id: `itunes:${a.collectionId}`,
    label: `${a.collectionName} — ${a.artistName}`,
    imageUrl: a.artworkUrl100,
  }))
}

/** コラボ/feat.クレジットの作品は参加アーティストそれぞれのカタログに同じ
 * apple_music_album_idが重複して存在しうるため、artist_idも合わせて絞り込む
 * (HRPPの手動マッチングで見つかった同種の不具合と同じ対策)。 */
// コラボ名義(同じapple_music_artist_idで複数のartist行が正当に存在しうる)の
// ため.maybeSingle()が複数件ヒットでエラーを返すことがある。dataだけ見て
// errorを無視すると「未登録」と誤認し、二重登録に繋がりうる(imase等の
// インシデントと同じアンチパターン)ため、エラー時はnull(未登録)ではなく
// throwして呼び出し元に伝える
async function findRegisteredAlbum(
  supabase: ReturnType<typeof createAdminClient>,
  itunesArtistId: number,
  collectionId: number
) {
  // 同じApple Music IDを持つartist行はコラボ名義等で正当に複数ありうるため、全員を対象に探す
  // (1件に絞ろうとすると複数ヒットでエラーになり登録が止まっていた。2026-10-09)
  const { data: artists, error: artistError } = await supabase
    .from('artist')
    .select('id')
    .eq('apple_music_artist_id', String(itunesArtistId))
  if (artistError) throw new Error(`アーティスト検索に失敗しました: ${artistError.message}`)
  const artistIds = (artists ?? []).map((a) => a.id as string)
  if (artistIds.length === 0) return null

  const { data: album, error: albumError } = await supabase
    .from('album')
    .select('id')
    .eq('apple_music_album_id', String(collectionId))
    .in('artist_id', artistIds)
    .limit(1)
    .maybeSingle()
  if (albumError) throw new Error(`アルバム検索に失敗しました: ${albumError.message}`)
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

/** 自動検索・手動検索のどちらでも見つからない場合向けに、Apple MusicアプリからコピーしたアルバムURLを
 * 直接貼り付けて解決できるようにする。URLからcollectionIdを取り出せれば、既存の
 * itunes:候補選択と同じ経路(linkRankingEntryCandidate)でそのまま登録する。 */
export async function linkRankingEntryByAppleMusicUrl(
  rankingId: string,
  entryId: number,
  oldAlbumId: string | null,
  oldArtistId: string | null,
  url: string
): Promise<LinkResult> {
  const parsed = parseAppleMusicAlbumUrl(url.trim())
  if (!parsed) {
    return { success: false, message: 'Apple MusicのアルバムURLとして認識できませんでした。' }
  }
  return linkRankingEntryCandidate(rankingId, entryId, oldAlbumId, oldArtistId, `itunes:${parsed.collectionId}`)
}
