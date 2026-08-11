'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'
import { createClient } from '@/utils/Supabase/server'
import { extractSpotifyTrackId, extractYoutubeVideoId } from '@/utils/format'

function redirectWith(result: 'success' | 'error', message: string) {
  redirect(`/admin/data?${result}=${encodeURIComponent(message)}`)
}

export type PickerItem = { id: string; label: string }

// SearchableSelect用のサーバーサイド検索。track/albumは件数が多く
// (2026年8月時点で4,000件超/1,000件超)、PostgRESTの1クエリ最大1000件の
// 制約上、全件を先読みしてクライアント側で絞り込む方式だと一部が欠落する
// (実例: マカロニえんぴつ「はしりがき」がヒットしなかった不具合)。
// 入力のたびにサーバー側でその場検索する方式に変更し、この問題を解消する。
export async function searchTracks(query: string): Promise<PickerItem[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from('track')
    .select('id, title, artist:artist_id(name)')
    .ilike('title', `%${trimmed}%`)
    .limit(20)
  return (data ?? []).map((t) => {
    const artist = Array.isArray(t.artist) ? t.artist[0] : t.artist
    return { id: t.id, label: `${t.title}${artist?.name ? ` — ${artist.name}` : ''}` }
  })
}

export async function searchAlbums(query: string): Promise<PickerItem[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from('album')
    .select('id, title, artist:artist_id(name)')
    .ilike('title', `%${trimmed}%`)
    .limit(20)
  return (data ?? []).map((a) => {
    const artist = Array.isArray(a.artist) ? a.artist[0] : a.artist
    return { id: a.id, label: `${a.title}${artist?.name ? ` — ${artist.name}` : ''}` }
  })
}

export async function updateArtist(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')

  if (!artistId) {
    redirectWith('error', '不正なリクエストです。')
  }

  const bio = String(formData.get('bio') ?? '').trim()
  const nameKana = String(formData.get('name_kana') ?? '').trim()
  const nameEn = String(formData.get('name_en') ?? '').trim()
  const artistType = String(formData.get('artist_type') ?? '').trim()
  const formedYearRaw = String(formData.get('formed_year') ?? '').trim()
  const originPrefecture = String(formData.get('origin_prefecture') ?? '').trim()
  const hometownCity = String(formData.get('hometown_city') ?? '').trim()
  const streamingStatus = String(formData.get('streaming_status') ?? '').trim()
  const officialSiteUrl = String(formData.get('official_site_url') ?? '').trim()
  const snsXUrl = String(formData.get('sns_x_url') ?? '').trim()
  const snsInstagramUrl = String(formData.get('sns_instagram_url') ?? '').trim()
  const imageUrl = String(formData.get('image_url') ?? '').trim()
  const spotifyArtistId = String(formData.get('spotify_artist_id') ?? '').trim()
  const urlLatestMv = String(formData.get('url_latest_mv') ?? '').trim()

  const formedYearNum = Number(formedYearRaw)
  const formedYear = formedYearRaw && !Number.isNaN(formedYearNum) ? formedYearNum : null

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('artist')
    .update({
      bio: bio || null,
      name_kana: nameKana || null,
      name_en: nameEn || null,
      artist_type: artistType || null,
      formed_year: formedYear,
      origin_prefecture: originPrefecture || null,
      hometown_city: hometownCity || null,
      streaming_status: streamingStatus || null,
      official_site_url: officialSiteUrl || null,
      sns_x_url: snsXUrl || null,
      sns_instagram_url: snsInstagramUrl || null,
      image_url: imageUrl || null,
      spotify_artist_id: spotifyArtistId || null,
      url_latest_mv: urlLatestMv || null,
    })
    .eq('id', artistId)

  if (error) {
    redirectWith('error', `更新に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath(`/artists/${artistId}`)
  redirectWith('success', 'アーティスト情報を更新しました。')
}

export async function updateAlbumStreamingStatus(formData: FormData) {
  const albumId = String(formData.get('album_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')
  const streamingStatus = String(formData.get('streaming_status') ?? '').trim()

  if (!albumId) {
    redirectWith('error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('album')
    .update({ streaming_status: streamingStatus || null })
    .eq('id', albumId)

  if (error) {
    redirectWith('error', `更新に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath(`/albums/${albumId}`)
  if (artistId) revalidatePath(`/artists/${artistId}`)
  redirectWith('success', 'アルバムの配信状況を更新しました。')
}

export async function updateTrack(formData: FormData) {
  const trackId = String(formData.get('track_id') ?? '')

  if (!trackId) {
    redirectWith('error', '不正なリクエストです。')
  }

  const spotifyTrackIdRaw = String(formData.get('spotify_track_id') ?? '').trim()
  const spotifyTrackId = spotifyTrackIdRaw ? extractSpotifyTrackId(spotifyTrackIdRaw) : null
  const amazonMusicTrackId = String(formData.get('amazon_music_track_id') ?? '').trim()
  const youtubeMusicTrackId = String(formData.get('youtube_music_track_id') ?? '').trim()
  const bandcampTrackId = String(formData.get('bandcamp_track_id') ?? '').trim()
  const soundcloudTrackId = String(formData.get('soundcloud_track_id') ?? '').trim()
  const tidalTrackId = String(formData.get('tidal_track_id') ?? '').trim()
  const youtubeVideoIdRaw = String(formData.get('youtube_video_id') ?? '').trim()
  const youtubeVideoId = youtubeVideoIdRaw ? extractYoutubeVideoId(youtubeVideoIdRaw) : null
  const lyricUrl = String(formData.get('lyric_url') ?? '').trim()
  const isrc = String(formData.get('isrc') ?? '').trim()
  const bpmRaw = String(formData.get('bpm') ?? '').trim()
  const trackReview = String(formData.get('track_review') ?? '').trim()

  const bpmNum = Number(bpmRaw)
  const bpm = bpmRaw && !Number.isNaN(bpmNum) ? bpmNum : null

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('track')
    .update({
      spotify_track_id: spotifyTrackId,
      amazon_music_track_id: amazonMusicTrackId || null,
      youtube_music_track_id: youtubeMusicTrackId || null,
      bandcamp_track_id: bandcampTrackId || null,
      soundcloud_track_id: soundcloudTrackId || null,
      tidal_track_id: tidalTrackId || null,
      youtube_video_id: youtubeVideoId,
      lyric_url: lyricUrl || null,
      isrc: isrc || null,
      bpm,
      track_review: trackReview || null,
    })
    .eq('id', trackId)

  if (error) {
    redirect(`/tracks/${trackId}?error=${encodeURIComponent(`更新に失敗しました: ${error.message}`)}`)
  }

  revalidatePath(`/tracks/${trackId}`)
  redirect(`/tracks/${trackId}?success=${encodeURIComponent('トラック情報を更新しました。')}`)
}
