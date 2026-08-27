'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchTracks, fetchTrackById } from '@/utils/itunes'

export type PickerItem = { id: string; label: string; imageUrl?: string }

/** HRPPの手動検索用。自動マッチング(scripts/backfill-radio-pick-itunes-candidates.ts)
 * で候補が見つからなかった行を、Apple Musicカタログ全体から検索して選べるようにする。 */
export async function searchAppleMusicTracksForPick(query: string): Promise<PickerItem[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  let results
  try {
    results = await searchTracks(trimmed, 10)
  } catch {
    return []
  }

  return results.map((r) => ({
    id: String(r.trackId),
    label: `${r.trackName} — ${r.artistName}`,
    imageUrl: r.artworkUrl100,
  }))
}

export type SetCandidateResult = { success: boolean; message: string }

/** 選んだトラックをradio_airplay_pick.candidate_*へ保存する(あくまで候補として。
 * artist/album本体への自動登録はしない、既存の自動マッチと同じ扱い)。 */
export async function setPickCandidateFromSearch(pickId: string, trackId: string): Promise<SetCandidateResult> {
  const supabase = createAdminClient()

  let match
  try {
    match = await fetchTrackById(Number(trackId))
  } catch {
    match = null
  }

  if (!match) {
    return { success: false, message: '候補の再取得に失敗しました。もう一度検索してください。' }
  }

  const { error } = await supabase
    .from('radio_airplay_pick')
    .update({
      candidate_track_id: match.trackId,
      candidate_track_name: match.trackName,
      candidate_artist_name: match.artistName,
      candidate_collection_id: match.collectionId,
      candidate_collection_name: match.collectionName,
      candidate_artwork_url: match.artworkUrl100 ?? null,
    })
    .eq('id', pickId)

  if (error) {
    return { success: false, message: `保存に失敗しました: ${error.message}` }
  }

  revalidatePath('/admin/data/media/radio-airplay-pick')
  return { success: true, message: '保存しました。' }
}
