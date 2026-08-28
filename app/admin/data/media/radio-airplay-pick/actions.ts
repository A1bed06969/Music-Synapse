'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchTracks, fetchTrackById, searchAlbums, fetchAlbumById } from '@/utils/itunes'
import { registerTrackFromSearch, registerAlbumFromSearch } from '@/app/admin/import/search/actions'
import { getStationPeriodType, isAlbumCampaign } from '@/utils/radioStationPeriod'

export type PickerItem = { id: string; label: string; imageUrl?: string }

type AdminClient = ReturnType<typeof createAdminClient>

/** コラボ/feat.クレジットの作品は、参加アーティストそれぞれのカタログに同じ
 * apple_music_album_idが重複して存在しうる(各自のディスコグラフィーに現れるため)。
 * artist_idも合わせて絞り込むことで、検索結果が正しく1件に定まるようにする。 */
async function findRegisteredAlbum(supabase: AdminClient, itunesArtistId: number, collectionId: number) {
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

async function findRegisteredTrack(supabase: AdminClient, itunesArtistId: number, trackId: number) {
  const { data: artist } = await supabase
    .from('artist')
    .select('id')
    .eq('apple_music_artist_id', String(itunesArtistId))
    .maybeSingle()
  if (!artist) return null

  const { data: track } = await supabase
    .from('track')
    .select('id')
    .eq('apple_music_track_id', String(trackId))
    .eq('artist_id', artist.id)
    .maybeSingle()
  return track
}

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

/** アルバム単位の選出(エフエム愛知/タワレコメン)向けの検索。 */
export async function searchAppleMusicAlbumsForPick(query: string): Promise<PickerItem[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  let results
  try {
    results = await searchAlbums(trimmed, 10)
  } catch {
    return []
  }

  return results.map((a) => ({
    id: String(a.collectionId),
    label: `${a.collectionName} — ${a.artistName}`,
    imageUrl: a.artworkUrl100,
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

/** アルバム単位の選出向け。選んだアルバムをcandidate_collection_*へ保存する。
 * candidate_track_idはあえて設定しない(登録時にトラック単位かアルバム単位かを
 * 区別する判定に使うため)。 */
export async function setAlbumCandidateFromSearch(pickId: string, collectionId: string): Promise<SetCandidateResult> {
  const supabase = createAdminClient()

  let match
  try {
    match = await fetchAlbumById(Number(collectionId))
  } catch {
    match = null
  }

  if (!match) {
    return { success: false, message: '候補の再取得に失敗しました。もう一度検索してください。' }
  }

  const { error } = await supabase
    .from('radio_airplay_pick')
    .update({
      candidate_track_id: null,
      candidate_track_name: null,
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

/** 本登録済み一覧での誤登録の取り消し用。radio_rotationの行を削除し、
 * registered_rotation_idをクリアして「マッチ済み・未登録」に戻す。候補自体は
 * 残すので、そのまま再登録することも、既存の解除ボタンで候補ごとクリアして
 * 検索し直す(再選択)こともできる。局・番組(media/media_program)のマスタ自体は
 * 他の実績からも参照されうる共有データのため削除しない。 */
export async function unregisterPickFromRotation(formData: FormData) {
  const pickId = String(formData.get('id') ?? '')
  if (!pickId) return

  const supabase = createAdminClient()
  const { data: pick } = await supabase
    .from('radio_airplay_pick')
    .select('registered_rotation_id')
    .eq('id', pickId)
    .single()

  if (pick?.registered_rotation_id) {
    await supabase.from('radio_rotation').delete().eq('id', pick.registered_rotation_id)
    await supabase.from('radio_airplay_pick').update({ registered_rotation_id: null }).eq('id', pickId)
  }

  revalidatePath('/admin/data/media/radio-airplay-pick')
  revalidatePath('/media/on-air')
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
    .select(
      'station_name, campaign_name, picked_date, is_domestic, candidate_track_id, candidate_collection_id, candidate_track_name, candidate_collection_name, candidate_artist_name'
    )
    .eq('id', pickId)
    .single()

  if (!pick || !pick.candidate_collection_id) {
    redirectWith('error', '候補情報が見つかりませんでした。')
  }

  const albumMode = isAlbumCampaign(pick.campaign_name)
  const candidateLabel = albumMode ? pick.candidate_collection_name : pick.candidate_track_name

  let trackId: string | null = null
  let albumId: string | null = null

  if (albumMode) {
    const itunesAlbum = await fetchAlbumById(pick.candidate_collection_id)
    if (!itunesAlbum) {
      redirectWith('error', `「${candidateLabel}」がiTunesで見つかりませんでした。`)
    }

    // コラボ/feat.クレジットの作品は同じapple_music_album_idが複数アーティストの
    // カタログに重複して存在しうるため(各参加アーティスト自身のディスコグラフィーにも
    // 同じ作品が現れる)、artist_idも合わせて絞り込まないと.maybeSingle()が
    // 「複数件ヒット」エラーで常にnullを返し、既に登録済みでも見つけられない
    // (実際にEBiDANのコラボ曲でこの不具合が発生した)
    const album = await findRegisteredAlbum(supabase, itunesAlbum!.artistId, pick.candidate_collection_id)
    if (album) {
      albumId = album.id
    } else {
      const registerResult = await registerAlbumFromSearch(pick.candidate_collection_id)
      if (!registerResult.success) {
        redirectWith('error', `カタログ登録に失敗しました: ${registerResult.message}`)
      }
      const reFetchedAlbum = await findRegisteredAlbum(supabase, itunesAlbum!.artistId, pick.candidate_collection_id)
      if (!reFetchedAlbum) {
        redirectWith('error', `「${candidateLabel}」はカタログ登録後も見つかりませんでした。`)
      }
      albumId = reFetchedAlbum!.id
    }
  } else {
    if (!pick.candidate_track_id) {
      redirectWith('error', '候補情報が見つかりませんでした。')
    }

    const itunesTrack = await fetchTrackById(pick.candidate_track_id)
    if (!itunesTrack) {
      redirectWith('error', `「${candidateLabel}」がiTunesで見つかりませんでした。`)
    }

    const track = await findRegisteredTrack(supabase, itunesTrack!.artistId, pick.candidate_track_id)
    if (track) {
      trackId = track.id
    } else {
      const registerResult = await registerTrackFromSearch(pick.candidate_collection_id)
      if (!registerResult.success) {
        redirectWith('error', `カタログ登録に失敗しました: ${registerResult.message}`)
      }
      const reFetchedTrack = await findRegisteredTrack(supabase, itunesTrack!.artistId, pick.candidate_track_id)
      if (!reFetchedTrack) {
        redirectWith(
          'error',
          `「${candidateLabel}」はカタログ登録後も見つかりませんでした(収録アルバムが変更/削除された可能性があります)。`
        )
      }
      trackId = reFetchedTrack!.id
    }
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
      track_id: trackId,
      album_id: albumId,
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
  redirectWith('success', `「${candidateLabel}」を登録しました。`)
}
