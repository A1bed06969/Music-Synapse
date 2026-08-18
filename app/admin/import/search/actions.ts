'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { createAdminClient } from '@/utils/Supabase/admin'
import {
  searchArtist,
  searchAlbums,
  searchTracks,
  fetchAlbumById,
  type ItunesArtistSearchResult,
  type ItunesAlbum,
  type ItunesTrackSearchResult,
} from '@/utils/itunes'
import {
  importArtistsFromItunes,
  upsertArtistFromItunes,
  registerSingleAlbum,
  fillMissingArtistImage,
} from '@/app/admin/import/actions'
import { dispatchMusicBrainzImport } from '@/utils/musicbrainzImportDispatch'

export type SearchArtistItem = ItunesArtistSearchResult & { alreadyRegistered: boolean }
export type SearchAlbumItem = ItunesAlbum & { alreadyRegistered: boolean }
export type SearchTrackItem = ItunesTrackSearchResult & { alreadyRegistered: boolean }

export type SearchForRegistrationResult = {
  artists: SearchArtistItem[]
  albums: SearchAlbumItem[]
  tracks: SearchTrackItem[]
}

/**
 * アーティスト/アルバム/トラックを並行検索し、それぞれDBに既に登録済みかどうかを
 * あわせて返す(検索候補一覧で「登録済み」表示するため)。service_role keyを
 * 使うDB照合をクライアントに晒さないよう、検索そのものもServer Action経由にする
 */
export async function searchForRegistration(term: string): Promise<SearchForRegistrationResult> {
  const trimmed = term.trim()
  if (trimmed.length < 2) {
    return { artists: [], albums: [], tracks: [] }
  }

  const supabase = createAdminClient()

  const [artists, albums, tracks] = await Promise.all([
    searchArtist(trimmed).catch((err) => {
      console.error('iTunesアーティスト検索に失敗しました:', err)
      return [] as ItunesArtistSearchResult[]
    }),
    searchAlbums(trimmed, 10).catch((err) => {
      console.error('iTunesアルバム検索に失敗しました:', err)
      return [] as ItunesAlbum[]
    }),
    searchTracks(trimmed, 10).catch((err) => {
      console.error('iTunesトラック検索に失敗しました:', err)
      return [] as ItunesTrackSearchResult[]
    }),
  ])

  const [{ data: existingArtists }, { data: existingAlbums }, { data: existingTracks }] = await Promise.all([
    artists.length > 0
      ? supabase
          .from('artist')
          .select('apple_music_artist_id')
          .in(
            'apple_music_artist_id',
            artists.map((a) => String(a.artistId))
          )
      : Promise.resolve({ data: [] as { apple_music_artist_id: string }[] }),
    albums.length > 0
      ? supabase
          .from('album')
          .select('apple_music_album_id')
          .in(
            'apple_music_album_id',
            albums.map((a) => String(a.collectionId))
          )
      : Promise.resolve({ data: [] as { apple_music_album_id: string }[] }),
    tracks.length > 0
      ? supabase
          .from('track')
          .select('apple_music_track_id')
          .in(
            'apple_music_track_id',
            tracks.map((t) => String(t.trackId))
          )
      : Promise.resolve({ data: [] as { apple_music_track_id: string }[] }),
  ])

  const registeredArtistIds = new Set((existingArtists ?? []).map((a) => a.apple_music_artist_id))
  const registeredAlbumIds = new Set((existingAlbums ?? []).map((a) => a.apple_music_album_id))
  const registeredTrackIds = new Set((existingTracks ?? []).map((t) => t.apple_music_track_id))

  return {
    artists: artists.map((a) => ({ ...a, alreadyRegistered: registeredArtistIds.has(String(a.artistId)) })),
    albums: albums.map((a) => ({ ...a, alreadyRegistered: registeredAlbumIds.has(String(a.collectionId)) })),
    tracks: tracks.map((t) => ({ ...t, alreadyRegistered: registeredTrackIds.has(String(t.trackId)) })),
  }
}

export type RegisterActionResult = { success: boolean; message: string }

/** アーティストを検索結果から登録する。既存のURL入力式バルク登録と全く同じ処理を
 * 再利用する(iTunesのURL/IDどちらでも受け付けるextractArtistIdFromUrlの仕様上、
 * 数字のIDをそのまま渡せる) */
export async function registerArtistFromSearch(appleArtistId: number): Promise<RegisterActionResult> {
  const [result] = await importArtistsFromItunes([String(appleArtistId)])
  revalidatePath('/admin/import/search')
  return { success: result.success, message: result.message }
}

/** アルバムを検索結果から登録する(収録トラックも含む)。アーティストが未登録なら
 * 先に本体だけ作成してから、そのアルバム1件だけをsyncする */
export async function registerAlbumFromSearch(collectionId: number): Promise<RegisterActionResult> {
  const supabase = createAdminClient()

  const album = await fetchAlbumById(collectionId)
  if (!album) {
    return { success: false, message: '指定のアルバムがiTunesで見つかりませんでした。' }
  }

  const { data: existingArtist } = await supabase
    .from('artist')
    .select('id')
    .eq('apple_music_artist_id', String(album.artistId))
    .maybeSingle()

  let artistId = existingArtist?.id as string | undefined
  if (!artistId) {
    const { artistId: newArtistId, errorMessage } = await upsertArtistFromItunes(supabase, {
      wrapperType: 'artist',
      artistId: album.artistId,
      artistName: album.artistName,
    })
    if (!newArtistId) {
      return { success: false, message: `アーティストの登録に失敗しました: ${errorMessage}` }
    }
    artistId = newArtistId
  }

  // URL入力式(app/admin/import)の一括登録と同じく、アーティスト画像の補完と
  // MusicBrainzプロフィール(公式サイト/SNS/ジャンル/メンバーシップ)の自動取込も
  // あわせて行う。ベストエフォートなので失敗してもアルバム登録自体は成功扱いにする
  try {
    await fillMissingArtistImage(supabase, artistId, String(album.artistId))
  } catch (err) {
    console.error(`アーティスト画像の補完に失敗しました(${album.artistName}):`, err)
  }

  const { trackCount } = await registerSingleAlbum(supabase, artistId, album.artistName, album)

  // レスポンスをブロックしないよう、レスポンス後にバックグラウンドでディスパッチする
  // (理由はutils/musicbrainzImportDispatch.tsのコメント参照)
  after(() => dispatchMusicBrainzImport(artistId!))

  revalidatePath('/admin/import/search')
  revalidatePath(`/artists/${artistId}`)
  return { success: true, message: `「${album.collectionName}」を登録しました(トラック${trackCount}件)。` }
}

/** トラックを検索結果から登録する。この巻き取りテーブル(track)はalbum単位で
 * まとめて登録する設計のため、収録元アルバムごと登録する(結果的に選んだ
 * トラックも登録される)。アーティスト未登録時の扱いはアルバム登録と同じ */
export async function registerTrackFromSearch(collectionId: number): Promise<RegisterActionResult> {
  return registerAlbumFromSearch(collectionId)
}
