'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchTracks, fetchTrackById } from '@/utils/itunes'
import { registerTrackFromSearch } from '@/app/admin/import/search/actions'
import { getStationPeriodType } from '@/utils/radioStationPeriod'

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

/** マッチ済み一覧での誤マッチ訂正用。候補をクリアし未マッチ一覧に戻す。 */
export async function clearPickCandidate(formData: FormData) {
  const pickId = String(formData.get('id') ?? '')
  if (!pickId) return

  const supabase = createAdminClient()
  await supabase
    .from('radio_airplay_pick')
    .update({
      candidate_track_id: null,
      candidate_track_name: null,
      candidate_artist_name: null,
      candidate_collection_id: null,
      candidate_collection_name: null,
      candidate_artwork_url: null,
    })
    .eq('id', pickId)

  revalidatePath('/admin/data/media/radio-airplay-pick')
}

function redirectWith(result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/media/radio-airplay-pick?view=matched&${result}=${encodeURIComponent(message)}`)
}

/** マッチ済み候補を本番のradio_rotationへ登録する(パワープレイ&ヘビロテページに反映)。
 * カタログに未登録のアーティスト/トラックは、検索・選択式バルク登録と同じ
 * registerTrackFromSearch(アルバム単位の正規登録、MusicBrainz補完・版統合込み)で
 * その場で登録してから紐付ける。局・番組も既存の手動登録(radio-pilot)と同じく
 * 名前一致がなければ新規作成する。 */
export async function registerPickToRotation(formData: FormData) {
  const pickId = String(formData.get('pick_id') ?? '')
  if (!pickId) redirectWith('error', '不正なリクエストです。')

  const supabase = createAdminClient()

  const { data: pick } = await supabase
    .from('radio_airplay_pick')
    .select('station_name, campaign_name, picked_date, is_domestic, candidate_track_id, candidate_collection_id, candidate_track_name, candidate_artist_name')
    .eq('id', pickId)
    .single()

  if (!pick || !pick.candidate_track_id || !pick.candidate_collection_id) {
    redirectWith('error', '候補情報が見つかりませんでした。')
  }

  let { data: track } = await supabase
    .from('track')
    .select('id')
    .eq('apple_music_track_id', String(pick.candidate_track_id))
    .maybeSingle()

  if (!track) {
    const registerResult = await registerTrackFromSearch(pick.candidate_collection_id)
    if (!registerResult.success) {
      redirectWith('error', `カタログ登録に失敗しました: ${registerResult.message}`)
    }
    const { data: reFetchedTrack } = await supabase
      .from('track')
      .select('id')
      .eq('apple_music_track_id', String(pick.candidate_track_id))
      .maybeSingle()
    track = reFetchedTrack
  }

  if (!track) {
    redirectWith(
      'error',
      `「${pick.candidate_track_name}」はカタログ登録後も見つかりませんでした(収録アルバムが変更/削除された可能性があります)。`
    )
  }

  const { data: existingMedia } = await supabase.from('media').select('id').eq('name', pick.station_name).maybeSingle()
  let mediaId = existingMedia?.id as string | undefined
  if (!mediaId) {
    const { data: createdMedia, error } = await supabase
      .from('media')
      .insert({ name: pick.station_name, media_type: 'radio' })
      .select('id')
      .single()
    if (error || !createdMedia) {
      redirectWith('error', `局の登録に失敗しました: ${error?.message}`)
    }
    mediaId = createdMedia!.id
  }

  const programName = pick.campaign_name || pick.station_name
  const { data: existingProgram } = await supabase
    .from('media_program')
    .select('id')
    .eq('media_id', mediaId!)
    .eq('program_name', programName)
    .maybeSingle()
  let programId = existingProgram?.id as string | undefined
  const periodType = getStationPeriodType(pick.station_name)
  if (!programId) {
    const { data: createdProgram, error } = await supabase
      .from('media_program')
      .insert({ media_id: mediaId, program_name: programName, period_type: periodType })
      .select('id')
      .single()
    if (error || !createdProgram) {
      redirectWith('error', `番組の登録に失敗しました: ${error?.message}`)
    }
    programId = createdProgram!.id
  }

  const { data: rotation, error: rotationError } = await supabase
    .from('radio_rotation')
    .insert({
      media_program_id: programId,
      period_type: periodType,
      period_start_date: pick.picked_date,
      music_type: pick.is_domestic === false ? 'OVERSEAS' : 'DOMESTIC',
      track_id: track.id,
      note: `HRPP: ${pick.station_name}${pick.campaign_name ? `(${pick.campaign_name})` : ''}`,
    })
    .select('id')
    .single()

  if (rotationError || !rotation) {
    redirectWith('error', `登録に失敗しました: ${rotationError?.message}`)
  }

  await supabase.from('radio_airplay_pick').update({ registered_rotation_id: rotation!.id }).eq('id', pickId)

  revalidatePath('/admin/data/media/radio-airplay-pick')
  revalidatePath('/media/on-air')
  redirectWith('success', `「${pick.candidate_track_name}」を登録しました。`)
}
