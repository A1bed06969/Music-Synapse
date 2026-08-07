// app/admin/import/actions.ts
'use server'

import { createAdminClient } from '@/utils/Supabase/admin'
import {
  extractArtistIdFromUrl,
  fetchArtistWithAlbums,
  fetchTracksForAlbum,
  millisToSeconds,
} from '@/utils/itunes'

type ImportResult = {
  success: boolean
  message: string
  sourceUrl: string
  artistName?: string
  albumCount?: number
  trackCount?: number
}

export async function importArtistsFromItunes(artistUrls: string[]): Promise<ImportResult[]> {
  const results: ImportResult[] = []
  for (const url of artistUrls) {
    results.push(await importOneArtist(url))
  }
  return results
}

async function importOneArtist(artistUrl: string): Promise<ImportResult> {
  const itunesArtistId = extractArtistIdFromUrl(artistUrl)
  if (!itunesArtistId) {
    return {
      success: false,
      sourceUrl: artistUrl,
      message: 'URLからアーティストIDを取得できませんでした。Apple MusicのアーティストページURLを確認してください。',
    }
  }

  const supabase = createAdminClient()

  // ① アーティスト情報 + アルバム一覧を取得
  const { artist: itunesArtist, albums: itunesAlbums } = await fetchArtistWithAlbums(itunesArtistId)

  if (!itunesArtist) {
    return { success: false, sourceUrl: artistUrl, message: '指定のIDに該当するアーティストが見つかりませんでした。' }
  }

  // ② アーティストをupsert(apple_music_artist_idで既存判定)
  const { data: existingArtist } = await supabase
    .from('artist')
    .select('id, official_site_url')
    .eq('apple_music_artist_id', String(itunesArtist.artistId))
    .maybeSingle()

  let artistId: string

  if (existingArtist) {
    artistId = existingArtist.id
    await supabase
      .from('artist')
      .update({
        name: itunesArtist.artistName,
        // 手動編集フォームで設定済みの値は、再取込では上書きしない(空のときだけiTunesの値で埋める)
        official_site_url: existingArtist.official_site_url ?? (itunesArtist.artistLinkUrl ?? null),
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', artistId)
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from('artist')
      .insert({
        name: itunesArtist.artistName,
        apple_music_artist_id: String(itunesArtist.artistId),
        official_site_url: itunesArtist.artistLinkUrl ?? null,
        last_synced_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (insertError || !inserted) {
      return {
        success: false,
        sourceUrl: artistUrl,
        message: `アーティストの登録に失敗しました: ${insertError?.message}`,
      }
    }
    artistId = inserted.id
  }

  // ③ アルバムを1件ずつupsertし、収録トラックも取得して登録
  let totalTrackCount = 0

  for (const itunesAlbum of itunesAlbums) {
    const { data: existingAlbum } = await supabase
      .from('album')
      .select('id')
      .eq('apple_music_album_id', String(itunesAlbum.collectionId))
      .maybeSingle()

    let albumId: string

    // ④ このアルバムのトラック一覧を取得(アルバム名の正しい日本語表記もここから取る)
    const { tracks: itunesTracks, localizedCollectionName } = await fetchTracksForAlbum(itunesAlbum.collectionId)

    const albumPayload = {
      artist_id: artistId,
      title: localizedCollectionName ?? itunesAlbum.collectionName,
      release_date: itunesAlbum.releaseDate ? itunesAlbum.releaseDate.slice(0, 10) : null,
      track_count: itunesAlbum.trackCount ?? null,
      album_type: itunesAlbum.collectionType === 'Album' ? 'Album' : null,
      jacket_url: itunesAlbum.artworkUrl100
        ? itunesAlbum.artworkUrl100.replace('100x100', '1200x1200')
        : null,
      apple_music_album_id: String(itunesAlbum.collectionId),
      apple_music_available: true,
      last_synced_at: new Date().toISOString(),
    }

    if (existingAlbum) {
      albumId = existingAlbum.id
      await supabase.from('album').update(albumPayload).eq('id', albumId)
    } else {
      const { data: insertedAlbum, error: albumError } = await supabase
        .from('album')
        .insert(albumPayload)
        .select('id')
        .single()

      if (albumError || !insertedAlbum) {
        console.error('アルバム登録失敗:', itunesAlbum.collectionName, albumError?.message)
        continue // このアルバムはスキップして次へ
      }
      albumId = insertedAlbum.id
    }

    for (const itunesTrack of itunesTracks) {
      const { data: existingTrack } = await supabase
        .from('track')
        .select('id')
        .eq('apple_music_track_id', String(itunesTrack.trackId))
        .maybeSingle()

      const trackPayload = {
        album_id: albumId,
        artist_id: artistId,
        track_no: itunesTrack.trackNumber ?? null,
        disc_number: itunesTrack.discNumber ?? null,
        title: itunesTrack.trackName,
        duration_seconds: millisToSeconds(itunesTrack.trackTimeMillis),
        apple_music_track_id: String(itunesTrack.trackId),
        last_synced_at: new Date().toISOString(),
      }

      if (existingTrack) {
        await supabase.from('track').update(trackPayload).eq('id', existingTrack.id)
      } else {
        const { error: trackError } = await supabase.from('track').insert(trackPayload)
        if (trackError) {
          console.error('トラック登録失敗:', itunesTrack.trackName, trackError.message)
          continue
        }
      }
      totalTrackCount++
    }
  }

  return {
    success: true,
    sourceUrl: artistUrl,
    message: '登録が完了しました。',
    artistName: itunesArtist.artistName,
    albumCount: itunesAlbums.length,
    trackCount: totalTrackCount,
  }
}