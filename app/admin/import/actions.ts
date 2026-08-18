// app/admin/import/actions.ts
'use server'

import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/utils/Supabase/admin'
import {
  extractArtistIdFromUrl,
  fetchArtistWithAlbums,
  fetchTracksForAlbum,
  millisToSeconds,
  type ItunesArtist,
  type ItunesAlbum,
  type ItunesTrack,
} from '@/utils/itunes'
import { fetchAppleMusicArtistImage } from '@/utils/appleMusicImage'
import { autoImportFromMusicBrainz, autoImportFromDiscogs } from '@/utils/creditImport'
import { dispatchMusicBrainzImport } from '@/utils/musicbrainzImportDispatch'
import { classifyAlbumType } from '@/utils/albumType'

type ImportResult = {
  success: boolean
  message: string
  sourceUrl: string
  artistName?: string
  albumCount?: number
}

export async function importArtistsFromItunes(artistUrls: string[]): Promise<ImportResult[]> {
  const results: ImportResult[] = []
  for (const url of artistUrls) {
    try {
      results.push(await importOneArtist(url))
    } catch (err) {
      // 1件のアーティストで想定外の例外が起きても、バッチ内の残りのアーティストの
      // 処理を継続する(以前はここで無捕捉のまま伝播し、バッチ全体が静かに停止していた)
      console.error(`アーティスト登録処理で例外が発生しました(${url}):`, err)
      results.push({
        success: false,
        sourceUrl: url,
        message: `登録処理中にエラーが発生しました: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
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

  // apple_music_artist_idでは見つからなかった場合でも、完全一致する名前のartistが
  // 既にapple_music_artist_id未設定で存在するなら(MusicBrainzのバンドメンバー
  // 自動登録経由の空スタブ等)、新規作成せずそちらにapple_music_artist_idを補完して使う。
  // 同名重複artist行の発生を防ぐ(utils/artistProfileImport.tsの同種の対策と対になる)
  const { data: sameNameCandidates } = await supabase
    .from('artist')
    .select('id, official_site_url')
    .eq('name', itunesArtist.artistName)
    .is('apple_music_artist_id', null)
    .limit(1)

  if (sameNameCandidates && sameNameCandidates.length > 0) {
    const sameNameArtist = sameNameCandidates[0]
    const { error: linkError } = await supabase
      .from('artist')
      .update({
        apple_music_artist_id: String(itunesArtist.artistId),
        official_site_url: sameNameArtist.official_site_url ?? (itunesArtist.artistLinkUrl ?? null),
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', sameNameArtist.id)
    if (linkError) {
      return { artistId: null, errorMessage: linkError.message }
    }
    return { artistId: sameNameArtist.id, errorMessage: null }
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

/** 画像が未設定のアーティストのみ、Apple Musicの公開ページからOGP画像を取得して登録する
 * (取得失敗はベストエフォートで無視し、呼び出し元の処理は継続させる) */
export async function fillMissingArtistImage(
  supabase: SupabaseClient,
  artistId: string,
  appleMusicArtistId: string
): Promise<void> {
  const { data: artistRow } = await supabase.from('artist').select('image_url').eq('id', artistId).single()
  if (artistRow?.image_url) return
  const imageUrl = await fetchAppleMusicArtistImage(appleMusicArtistId)
  if (imageUrl) {
    await supabase.from('artist').update({ image_url: imageUrl }).eq('id', artistId)
  }
}

/** 1アルバム分をupsertし、収録トラックの取得・登録・クレジット取込までを行う。
 * existingAlbumIdがnullなら新規登録、そうでなければ更新として扱う。
 * 戻り値は登録・更新できたトラック数(取得失敗などでスキップした場合は0)。 */
async function syncOneAlbum(
  supabase: SupabaseClient,
  artistId: string,
  artistName: string,
  itunesAlbum: ItunesAlbum,
  existingAlbumId: string | null
): Promise<number> {
  // iTunes側の一時的なエラー(レート制限等)でここが失敗しても、このアルバムだけ
  // スキップして呼び出し元(残りのアルバムのループ)は継続させる(以前は無捕捉のまま
  // 伝播し、このアーティストの残り全アルバムの処理が静かに停止していた)
  let itunesTracks: ItunesTrack[]
  let localizedCollectionName: string | null
  try {
    const trackResult = await fetchTracksForAlbum(itunesAlbum.collectionId)
    itunesTracks = trackResult.tracks
    localizedCollectionName = trackResult.localizedCollectionName
  } catch (err) {
    console.error(`トラック一覧の取得に失敗しました(${itunesAlbum.collectionName}):`, err)
    return 0
  }

  const title = localizedCollectionName ?? itunesAlbum.collectionName
  const albumPayload = {
    artist_id: artistId,
    title,
    release_date: itunesAlbum.releaseDate ? itunesAlbum.releaseDate.slice(0, 10) : null,
    track_count: itunesAlbum.trackCount ?? null,
    jacket_url: itunesAlbum.artworkUrl100 ? itunesAlbum.artworkUrl100.replace('100x100', '1200x1200') : null,
    apple_music_album_id: String(itunesAlbum.collectionId),
    apple_music_available: true,
    last_synced_at: new Date().toISOString(),
  }

  let albumId: string
  if (existingAlbumId) {
    // album_typeは更新対象に含めない(手動修正が再同期のたびに上書きされないようにするため)
    albumId = existingAlbumId
    const { error: albumUpdateError } = await supabase.from('album').update(albumPayload).eq('id', albumId)
    if (albumUpdateError) {
      console.error('アルバム更新失敗:', itunesAlbum.collectionName, albumUpdateError.message)
    }
  } else {
    const { data: insertedAlbum, error: albumError } = await supabase
      .from('album')
      .insert({ ...albumPayload, album_type: classifyAlbumType(title, itunesAlbum.trackCount ?? null) })
      .select('id')
      .single()

    if (albumError || !insertedAlbum) {
      console.error('アルバム登録失敗:', itunesAlbum.collectionName, albumError?.message)
      return 0
    }
    albumId = insertedAlbum.id
  }

  const albumTrackList: { id: string; title: string }[] = []
  let trackCount = 0

  for (const itunesTrack of itunesTracks) {
    // apple_music_track_idだけでなくalbum_idでも絞り込む(album側と同じ理由:
    // フィーチャリング曲は同じtrackIdが複数アーティストのアルバムに重複して
    // 現れうるため、album_idで絞らないと別アルバムのトラックを誤って拾ってしまう)
    const { data: existingTrack } = await supabase
      .from('track')
      .select('id')
      .eq('apple_music_track_id', String(itunesTrack.trackId))
      .eq('album_id', albumId)
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
      const { error: trackUpdateError } = await supabase.from('track').update(trackPayload).eq('id', existingTrack.id)
      if (trackUpdateError) {
        console.error('トラック更新失敗:', itunesTrack.trackName, trackUpdateError.message)
      }
      albumTrackList.push({ id: existingTrack.id, title: itunesTrack.trackName })
    } else {
      const { data: insertedTrack, error: trackError } = await supabase
        .from('track')
        .insert(trackPayload)
        .select('id')
        .single()
      if (trackError || !insertedTrack) {
        console.error('トラック登録失敗:', itunesTrack.trackName, trackError?.message)
        continue
      }
      albumTrackList.push({ id: insertedTrack.id, title: itunesTrack.trackName })
    }
    trackCount++
  }

  // このアルバムのクレジットをMusicBrainz→Discogsの順で試みる(タイトル完全一致時のみ、
  // ベストエフォート。取得失敗・不一致はアルバム・トラック登録自体には影響させない)
  const albumForCredits = { id: albumId, title: albumPayload.title }
  try {
    await autoImportFromMusicBrainz(supabase, artistId, artistName, albumForCredits, albumTrackList)
  } catch (err) {
    console.error(`MusicBrainzクレジット取込に失敗しました(${albumPayload.title}):`, err)
  }
  try {
    await autoImportFromDiscogs(supabase, artistId, artistName, albumForCredits, albumTrackList)
  } catch (err) {
    console.error(`Discogsクレジット取込に失敗しました(${albumPayload.title}):`, err)
  }

  return trackCount
}

/** 検索・選択式の登録UI(app/admin/import/search)から、1件だけアルバムを
 * 登録するための公開ラッパー。artist_idでの既存判定込みでsyncOneAlbumを呼ぶ */
export async function registerSingleAlbum(
  supabase: SupabaseClient,
  artistId: string,
  artistName: string,
  itunesAlbum: ItunesAlbum
): Promise<{ trackCount: number }> {
  const { data: existingAlbum } = await supabase
    .from('album')
    .select('id')
    .eq('apple_music_album_id', String(itunesAlbum.collectionId))
    .eq('artist_id', artistId)
    .maybeSingle()

  const trackCount = await syncOneAlbum(supabase, artistId, artistName, itunesAlbum, existingAlbum?.id ?? null)
  return { trackCount }
}

/** 配信停止検知: 今回のiTunes取得結果に含まれなかった既存アルバムは削除せず、
 * 「配信停止の可能性」としてステータスだけ更新する(定期的な再同期での運用を想定。
 * 既に/artists/unreleasedページ等で使われているstreaming_status='none'を流用する) */
async function flagDelistedAlbums(supabase: SupabaseClient, artistId: string, itunesAlbums: ItunesAlbum[]): Promise<void> {
  const fetchedAlbumIds = new Set(itunesAlbums.map((a) => String(a.collectionId)))
  const { data: existingArtistAlbums } = await supabase
    .from('album')
    .select('id, apple_music_album_id, streaming_status')
    .eq('artist_id', artistId)
    .not('apple_music_album_id', 'is', null)

  for (const existing of existingArtistAlbums ?? []) {
    if (existing.apple_music_album_id && !fetchedAlbumIds.has(existing.apple_music_album_id)) {
      if (existing.streaming_status === 'none') continue // 既に反映済み
      const { error: delistError } = await supabase
        .from('album')
        .update({
          apple_music_available: false,
          streaming_status: 'none',
          streaming_note: '前回の同期ではiTunesで確認できましたが、今回の同期では見つかりませんでした(配信停止の可能性があります)',
        })
        .eq('id', existing.id)
      if (delistError) {
        console.error('配信停止ステータスの更新に失敗しました:', existing.id, delistError.message)
      }
    }
  }
}

/** 指定アーティストのアルバムを1件ずつupsertし、収録トラックも取得して登録する。
 * iTunes APIのレート制限対策で1アルバムごとに間隔を空けるため、アルバム数が
 * 多いアーティストは数十秒〜かかることがある(呼び出し側で長時間処理として扱うこと)。
 * アルバムごとにMusicBrainz→Discogsでクレジット取込も試みる(完全一致時のみ、
 * ベストエフォート)ため、クレジットが多いアーティストはさらに時間がかかる。
 * 新規登録・既存アーティストのURL再投入(全アルバムを検査し直したい場合)向け。
 * 定期的な軽量リフレッシュには refreshArtistCatalog を使うこと */
export async function syncAlbumsAndTracksForArtist(
  supabase: SupabaseClient,
  artistId: string,
  artistName: string,
  itunesAlbums: ItunesAlbum[],
  appleMusicArtistId: string
): Promise<number> {
  await fillMissingArtistImage(supabase, artistId, appleMusicArtistId)

  let totalTrackCount = 0

  for (const itunesAlbum of itunesAlbums) {
    // apple_music_album_idだけでなくartist_idでも絞り込む。フィーチャリング/コラボ曲は
    // 同じiTunesのcollectionIdが複数アーティストのディスコグラフィーに重複して現れることがあり、
    // artist_idで絞らないと後からsyncしたアーティストが既存の別アーティストの登録を
    // 奪ってしまう(artist_idを無条件に上書きしてしまう)ため
    const { data: existingAlbum } = await supabase
      .from('album')
      .select('id')
      .eq('apple_music_album_id', String(itunesAlbum.collectionId))
      .eq('artist_id', artistId)
      .maybeSingle()

    totalTrackCount += await syncOneAlbum(supabase, artistId, artistName, itunesAlbum, existingAlbum?.id ?? null)
  }

  await flagDelistedAlbums(supabase, artistId, itunesAlbums)

  return totalTrackCount
}

/** 定期リフレッシュ用の軽量版。DBに既にあるアルバムは一切触らず(トラック取得・
 * クレジット再取込をしない)、iTunesの最新ディスコグラフィーと突き合わせて
 * 「新規アルバム」だけを取り込む。加えて画像未設定なら補完し、配信停止検知も行う。
 * 既存アルバムを毎回全件洗い直すsyncAlbumsAndTracksForArtistと違い、
 * カタログが大きくなっても1アーティストあたりの処理時間が新譜の数に比例するだけなので、
 * 全アーティストの定期一括リフレッシュ(scripts/resync-all-artists.ts)に向く */
export async function refreshArtistCatalog(
  supabase: SupabaseClient,
  artistId: string,
  artistName: string,
  itunesAlbums: ItunesAlbum[],
  appleMusicArtistId: string
): Promise<{ newAlbumCount: number; newTrackCount: number }> {
  await fillMissingArtistImage(supabase, artistId, appleMusicArtistId)

  const { data: existingAlbums } = await supabase
    .from('album')
    .select('apple_music_album_id')
    .eq('artist_id', artistId)
    .not('apple_music_album_id', 'is', null)
  const knownAlbumIds = new Set((existingAlbums ?? []).map((a) => a.apple_music_album_id as string))

  let newAlbumCount = 0
  let newTrackCount = 0

  for (const itunesAlbum of itunesAlbums) {
    if (knownAlbumIds.has(String(itunesAlbum.collectionId))) continue // 既存アルバムは触らない
    newTrackCount += await syncOneAlbum(supabase, artistId, artistName, itunesAlbum, null)
    newAlbumCount++
  }

  await flagDelistedAlbums(supabase, artistId, itunesAlbums)

  return { newAlbumCount, newTrackCount }
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

  // アルバム数が多いアーティストだとアルバム・トラックの取込に数十秒〜数分かかり、
  // サーバー関数の実行時間上限を超えて処理が中断される恐れがある
  // (festival-pilotのimportAndRegisterFestivalArtistと同じ対策)。
  // そのためアーティスト本体の登録だけ先に完了させてすぐ結果を返し、
  // アルバム・トラックの取込はafter()でレスポンス後にバックグラウンド実行する
  after(async () => {
    try {
      await syncAlbumsAndTracksForArtist(
        supabase,
        artistId,
        itunesArtist.artistName,
        itunesAlbums,
        String(itunesArtist.artistId)
      )
    } catch (err) {
      console.error(`アルバム・トラック取込に失敗しました(${itunesArtist.artistName}):`, err)
    }

    // MusicBrainzの公式サイト/SNS/ジャンルもあわせて取り込む(タイトル完全一致での
    // MBID自動照合のみ、ベストエフォート。アルバム登録が先に済んでいる必要があるため
    // syncAlbumsAndTracksForArtistの後に実行する)。
    // 別関数呼び出しとして切り離す理由はutils/musicbrainzImportDispatch.tsのコメント参照
    await dispatchMusicBrainzImport(artistId)

    revalidatePath(`/artists/${artistId}`)
  })

  return {
    success: true,
    sourceUrl: artistUrl,
    message: `「${itunesArtist.artistName}」を登録しました(アルバム${itunesAlbums.length}件は裏で取込中です)。`,
    artistName: itunesArtist.artistName,
    albumCount: itunesAlbums.length,
  }
}