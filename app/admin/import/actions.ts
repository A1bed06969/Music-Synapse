// app/admin/import/actions.ts
'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/utils/Supabase/admin'
import {
  extractArtistIdFromUrl,
  fetchArtistWithAlbums,
  fetchTracksForAlbum,
  millisToSeconds,
  type ItunesArtist,
  type ItunesAlbum,
} from '@/utils/itunes'
import { fetchAppleMusicArtistImage } from '@/utils/appleMusicImage'

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

/** アーティスト本体だけをupsertする(apple_music_artist_idで既存判定)。
 * アルバム・トラックの取込は含まないため高速(呼び出し側で別途 syncAlbumsAndTracksForArtist を呼ぶこと) */
export async function upsertArtistFromItunes(
  supabase: SupabaseClient,
  itunesArtist: ItunesArtist
): Promise<{ artistId: string | null; errorMessage: string | null }> {
  const { data: existingArtist } = await supabase
    .from('artist')
    .select('id, official_site_url')
    .eq('apple_music_artist_id', String(itunesArtist.artistId))
    .maybeSingle()

  if (existingArtist) {
    await supabase
      .from('artist')
      .update({
        name: itunesArtist.artistName,
        // 手動編集フォームで設定済みの値は、再取込では上書きしない(空のときだけiTunesの値で埋める)
        official_site_url: existingArtist.official_site_url ?? (itunesArtist.artistLinkUrl ?? null),
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', existingArtist.id)
    return { artistId: existingArtist.id, errorMessage: null }
  }

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
    return { artistId: null, errorMessage: insertError?.message ?? 'unknown error' }
  }
  return { artistId: inserted.id, errorMessage: null }
}

/** 指定アーティストのアルバムを1件ずつupsertし、収録トラックも取得して登録する。
 * iTunes APIのレート制限対策で1アルバムごとに間隔を空けるため、アルバム数が
 * 多いアーティストは数十秒〜かかることがある(呼び出し側で長時間処理として扱うこと) */
export async function syncAlbumsAndTracksForArtist(
  supabase: SupabaseClient,
  artistId: string,
  itunesAlbums: ItunesAlbum[],
  appleMusicArtistId: string
): Promise<number> {
  // 画像が未設定のアーティストのみ、Apple Musicの公開ページからOGP画像を取得して登録する
  // (取得失敗はベストエフォートで無視し、アルバム・トラック取込は継続する)
  const { data: artistRow } = await supabase.from('artist').select('image_url').eq('id', artistId).single()
  if (!artistRow?.image_url) {
    const imageUrl = await fetchAppleMusicArtistImage(appleMusicArtistId)
    if (imageUrl) {
      await supabase.from('artist').update({ image_url: imageUrl }).eq('id', artistId)
    }
  }

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
        preview_url: itunesTrack.previewUrl ?? null,
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

  return totalTrackCount
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

  const { artist: itunesArtist, albums: itunesAlbums } = await fetchArtistWithAlbums(itunesArtistId)
  if (!itunesArtist) {
    return { success: false, sourceUrl: artistUrl, message: '指定のIDに該当するアーティストが見つかりませんでした。' }
  }

  const { artistId, errorMessage } = await upsertArtistFromItunes(supabase, itunesArtist)
  if (!artistId) {
    return { success: false, sourceUrl: artistUrl, message: `アーティストの登録に失敗しました: ${errorMessage}` }
  }

  const totalTrackCount = await syncAlbumsAndTracksForArtist(
    supabase,
    artistId,
    itunesAlbums,
    String(itunesArtist.artistId)
  )

  return {
    success: true,
    sourceUrl: artistUrl,
    message: '登録が完了しました。',
    artistName: itunesArtist.artistName,
    albumCount: itunesAlbums.length,
    trackCount: totalTrackCount,
  }
}