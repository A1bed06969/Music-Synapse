// app/admin/import/actions.ts
'use server'

import { afterOrNow } from '@/utils/afterOrNow'
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
import { dispatchAlbumSync } from '@/utils/albumSyncDispatch'
import { classifyAlbumType } from '@/utils/albumType'
import { judgeSameArtistWithGemini } from '@/utils/geminiArtistMatch'
import { extractFeaturedNames } from '@/utils/featuringBillingOrder'

// 同名だが別のapple_music_artist_idを持つ既存アーティストとの同一人物判定で、
// これ以上の確信度が無ければ自動統合しない(同姓同名の別人を誤って統合する
// リスクを避けるため、app/admin/data/artists/unmatched/geminiMatchActions.tsの
// AUTO_APPLY_THRESHOLDと同じ値を踏襲)
const SAME_ARTIST_AUTO_APPLY_THRESHOLD = 0.9

type ImportResult = {
  success: boolean
  message: string
  sourceUrl: string
  artistName?: string
  albumCount?: number
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ])
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

  // 空スタブとしても見つからなかった場合、名前が完全一致するが既に別の
  // apple_music_artist_idで本登録済みのartistが無いか確認する。iTunes検索結果の
  // artistIdの揺れ(地域違いのカタログエントリ等)で同一人物が二重登録されるのを
  // 防ぐため(2026-09-12のアーティスト重複統合作業で判明した実際の重複原因の
  // ひとつ)。ただし同姓同名の別人という可能性も否定できないため、Geminiに
  // ジャンル・出身国を材料に判定させ、確信が持てる場合のみ既存行を再利用する。
  // 確信が持てない場合は新規作成した上でartist_match_logに記録し、人力確認に
  // 委ねる(誤って別人を統合しないことを、重複行が残ることより優先する設計)。
  const { data: sameNameRegistered } = await supabase
    .from('artist')
    .select('id, hometown_country')
    .eq('name', itunesArtist.artistName)
    .not('apple_music_artist_id', 'is', null)
    .limit(1)
    .maybeSingle()

  let collisionLog: { existingArtistId: string; confidence: number; reasoning: string } | null = null

  if (sameNameRegistered) {
    const { data: genreLinks } = await supabase
      .from('artist_genre')
      .select('genre:genre_id(name)')
      .eq('artist_id', sameNameRegistered.id)
      .limit(1)
    // genre:genre_id(name)の戻り値の型はオブジェクト/配列のどちらもあり得る
    // (scripts/generate-artist-bios.tsのfetchGenreNamesと同じ防御的な扱い)
    const rawGenre = genreLinks?.[0]?.genre as { name: string } | { name: string }[] | null | undefined
    const existingGenreName = (Array.isArray(rawGenre) ? rawGenre[0]?.name : rawGenre?.name) ?? null

    let judgement: { sameArtist: boolean; confidence: number; reasoning: string }
    try {
      judgement = await judgeSameArtistWithGemini(
        { name: itunesArtist.artistName, primaryGenreName: existingGenreName, hometownCountry: sameNameRegistered.hometown_country },
        { name: itunesArtist.artistName, primaryGenreName: itunesArtist.primaryGenreName ?? null }
      )
    } catch (err) {
      console.error(`同名アーティスト同一判定に失敗(${itunesArtist.artistName}): ${(err as Error).message}`)
      judgement = { sameArtist: false, confidence: 0, reasoning: '判定処理でエラーが発生したため未確認扱い' }
    }

    if (judgement.sameArtist && judgement.confidence >= SAME_ARTIST_AUTO_APPLY_THRESHOLD) {
      return { artistId: sameNameRegistered.id, errorMessage: null }
    }

    console.warn(
      `⚠️ 同名アーティスト「${itunesArtist.artistName}」が既に本登録済み(id=${sameNameRegistered.id})ですが、別のapple_music_artist_idのため同一人物と確信できず(確信度${judgement.confidence}: ${judgement.reasoning})、新規に登録します。要確認。`
    )
    collisionLog = { existingArtistId: sameNameRegistered.id, confidence: judgement.confidence, reasoning: judgement.reasoning }
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

  if (collisionLog) {
    const { error: logError } = await supabase.from('artist_match_log').insert({
      stub_artist_id: inserted.id,
      stub_artist_name: itunesArtist.artistName,
      chosen_apple_music_artist_id: null,
      chosen_artist_name: null,
      chosen_country: null,
      confidence: collisionLog.confidence,
      reasoning: `同名の既存アーティスト(id=${collisionLog.existingArtistId})との同一人物判定: ${collisionLog.reasoning}`,
      candidates_json: [{ existingArtistId: collisionLog.existingArtistId }],
      auto_applied: false,
    })
    if (logError) console.error(`artist_match_logへの記録に失敗(${itunesArtist.artistName}): ${logError.message}`)
  }

  return { artistId: inserted.id, errorMessage: null }
}

/** 画像が未設定のアーティストのみ、Apple Musicの公開ページからOGP画像を取得して登録する
 * (取得失敗はベストエフォートで無視し、呼び出し元の処理は継続させる) */
export async function fillMissingArtistImage(
  supabase: SupabaseClient,
  artistId: string,
  appleMusicArtistId: string,
  country = 'JP'
): Promise<void> {
  const { data: artistRow } = await supabase.from('artist').select('image_url').eq('id', artistId).single()
  if (artistRow?.image_url) return
  const imageUrl = await fetchAppleMusicArtistImage(appleMusicArtistId, country)
  if (imageUrl) {
    await supabase.from('artist').update({ image_url: imageUrl }).eq('id', artistId)
  }
}

/** track.titleが新規に"(feat. X)"パターンを含む場合、Xと完全一致する既存の
 * artist行があればtrack_artistへ追加する。完全一致するartistが存在しない
 * 場合はスタブを作成せずスキップする(カンマ/アンパサンド区切りの抽出名は
 * "Tyler, The Creator"のような単一アーティスト名の一部を誤って分割して
 * しまうことがあり、未知の名前を恒久的なartist行として自動作成するのは
 * 危険なため)。 */
async function linkOrStubFeaturedArtists(supabase: SupabaseClient, trackId: string, trackTitle: string): Promise<void> {
  const featuredNames = extractFeaturedNames(trackTitle)
  if (!featuredNames || featuredNames.length === 0) return

  for (const [index, name] of featuredNames.entries()) {
    const { data: existingArtist, error: selectError } = await supabase
      .from('artist')
      .select('id')
      .eq('name', name)
      .maybeSingle()
    if (selectError) {
      console.error(`フィーチャリングアーティスト確認に失敗しました(${name}):`, selectError.message)
      continue
    }

    if (!existingArtist) continue
    const artistId = existingArtist.id

    const { data: existingLink, error: linkSelectError } = await supabase
      .from('track_artist')
      .select('id')
      .eq('track_id', trackId)
      .eq('artist_id', artistId)
      .maybeSingle()
    if (linkSelectError) {
      console.error(`track_artist確認に失敗しました(${name}):`, linkSelectError.message)
      continue
    }
    if (existingLink) continue

    const { error: linkInsertError } = await supabase
      .from('track_artist')
      .insert({ track_id: trackId, artist_id: artistId, role: 'featured', billing_order: index + 2 })
    if (linkInsertError) {
      console.error(`track_artist登録に失敗しました(${name}):`, linkInsertError.message)
    }
  }
}

/** 1アルバム分をupsertし、収録トラックの取得・登録・クレジット取込までを行う。
 * existingAlbumIdがnullなら新規登録、そうでなければ更新として扱う。
 * 戻り値は登録・更新できたトラック数(取得失敗などでスキップした場合は0)。
 * skipCreditImportがtrueの場合、クレジット取込(MusicBrainz→Discogs)を省略する
 * (大量アルバムの一括同期でチャンクあたりの処理数を稼ぎ、Vercelの自己ディスパッチ
 * ホップ数を減らすため。省略されたクレジットはscripts/backfill-album-credits.tsが
 * 別途拾う) */
export async function syncOneAlbum(
  supabase: SupabaseClient,
  artistId: string,
  artistName: string,
  itunesAlbum: ItunesAlbum,
  existingAlbumId: string | null,
  skipCreditImport = false,
  country = 'JP'
): Promise<number> {
  // iTunes側の一時的なエラー(レート制限等)でここが失敗しても、このアルバムだけ
  // スキップして呼び出し元(残りのアルバムのループ)は継続させる(以前は無捕捉のまま
  // 伝播し、このアーティストの残り全アルバムの処理が静かに停止していた)
  let itunesTracks: ItunesTrack[]
  let localizedCollectionName: string | null
  try {
    const trackResult = await fetchTracksForAlbum(itunesAlbum.collectionId, country)
    itunesTracks = trackResult.tracks
    localizedCollectionName = trackResult.localizedCollectionName
  } catch (err) {
    console.error(`トラック一覧の取得に失敗しました(${itunesAlbum.collectionName}):`, err)
    return 0
  }

  // collectionルックアップ(entity=song)がアルバム自体は返しつつ収録曲を1件も
  // 返さないことが稀にある(Apple Music側のカタログ不整合。アルバム単体の
  // ルックアップ(entity=album)ではtrackCountが正しく1以上でも、entity=songだと
  // 曲が紐付いて返ってこないケースを実際に確認した — OWV「Lovey-Dovey」等)。
  // 例外は投げないため気づかれずアルバムだけ空で登録されてしまう。せめてログに
  // 残し、後から気付けるようにする(トラックIDが分かっていれば個別ルックアップ
  // (fetchTrackById)で復旧できる)。
  if (itunesTracks.length === 0 && (itunesAlbum.trackCount ?? 0) > 0) {
    console.error(
      `トラック一覧が0件でした(Apple Music側の索引不整合の可能性): ${itunesAlbum.collectionName} (collectionId=${itunesAlbum.collectionId}, 本来のtrackCount=${itunesAlbum.trackCount})`
    )
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
  let createdAlbumArtistId: string | null = null
  let trackOwnerArtistId = artistId
  if (existingAlbumId) {
    // album_typeは更新対象に含めない(手動修正が再同期のたびに上書きされないようにするため)
    albumId = existingAlbumId
    const { error: albumUpdateError } = await supabase.from('album').update(albumPayload).eq('id', albumId)
    if (albumUpdateError) {
      console.error('アルバム更新失敗:', itunesAlbum.collectionName, albumUpdateError.message)
    }
  } else {
    // 新規作成前に、同一apple_music_album_idを持つアルバムが既に「別の」
    // artist_idの下に存在しないか確認する(フィーチャリング曲のアルバムが
    // 参加アーティストごとに重複登録されるのを防ぐ。2026-09-14の調査で、
    // これを怠ったことが実際に多数の重複album/trackを生んでいたことを確認した)
    const { data: crossArtistAlbums, error: crossArtistError } = await supabase
      .from('album')
      .select('id, artist_id')
      .eq('apple_music_album_id', String(itunesAlbum.collectionId))
      .neq('artist_id', artistId)
      .order('id', { ascending: true })
      .limit(1)
    if (crossArtistError) {
      console.error('別アーティスト下の既存アルバム確認に失敗しました:', itunesAlbum.collectionName, crossArtistError.message)
    }
    const crossArtistAlbum = crossArtistAlbums?.[0] ?? null

    if (crossArtistAlbum) {
      // 既存のアルバムを再利用し、このアーティストをalbum_artistとして追加する
      // (album.artist_idは変更しない。既存の全ページ・クエリの動作を変えないため)
      albumId = crossArtistAlbum.id
      createdAlbumArtistId = artistId
      trackOwnerArtistId = crossArtistAlbum.artist_id
      // artist_idは除外する(album.artist_idは既存の持ち主のまま変更しない。
      // 上のコメント通り、これを怠るとalbumPayloadのartist_idで上書きされてしまう)
      const { artist_id: _unusedArtistId, ...albumPayloadWithoutArtist } = albumPayload
      const { error: albumUpdateError } = await supabase
        .from('album')
        .update(albumPayloadWithoutArtist)
        .eq('id', albumId)
      if (albumUpdateError) {
        console.error('アルバム更新失敗(既存アルバム再利用):', itunesAlbum.collectionName, albumUpdateError.message)
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
  }

  if (createdAlbumArtistId) {
    const { data: existingAlbumArtist, error: albumArtistSelectError } = await supabase
      .from('album_artist')
      .select('id')
      .eq('album_id', albumId)
      .eq('artist_id', createdAlbumArtistId)
      .maybeSingle()
    if (albumArtistSelectError) {
      console.error('album_artist確認に失敗しました:', itunesAlbum.collectionName, albumArtistSelectError.message)
    } else if (!existingAlbumArtist) {
      const { count: existingCount } = await supabase
        .from('album_artist')
        .select('id', { count: 'exact', head: true })
        .eq('album_id', albumId)
      const { error: albumArtistInsertError } = await supabase
        .from('album_artist')
        .insert({ album_id: albumId, artist_id: createdAlbumArtistId, role: 'featured', billing_order: (existingCount ?? 0) + 1 })
      if (albumArtistInsertError) {
        console.error('album_artist登録に失敗しました:', itunesAlbum.collectionName, albumArtistInsertError.message)
      }
    }
  }

  const albumTrackList: { id: string; title: string }[] = []
  let trackCount = 0

  for (const itunesTrack of itunesTracks) {
    // apple_music_track_idだけでなくalbum_idでも絞り込む(album側と同じ理由:
    // フィーチャリング曲は同じtrackIdが複数アーティストのアルバムに重複して
    // 現れうるため、album_idで絞らないと別アルバムのトラックを誤って拾ってしまう)
    const { data: existingTrack, error: existingTrackError } = await supabase
      .from('track')
      .select('id')
      .eq('apple_music_track_id', String(itunesTrack.trackId))
      .eq('album_id', albumId)
      .maybeSingle()
    if (existingTrackError) {
      console.error(`既存track確認に失敗しました(${itunesTrack.trackName}):`, existingTrackError.message)
    }

    const trackPayload = {
      album_id: albumId,
      artist_id: trackOwnerArtistId,
      track_no: itunesTrack.trackNumber ?? null,
      disc_number: itunesTrack.discNumber ?? null,
      title: itunesTrack.trackName,
      duration_seconds: millisToSeconds(itunesTrack.trackTimeMillis),
      apple_music_track_id: String(itunesTrack.trackId),
      preview_url: itunesTrack.previewUrl ?? null,
      last_synced_at: new Date().toISOString(),
    }

    if (existingTrack) {
      // artist_idは除外する(track.artist_idは既存の持ち主のまま変更しない。
      // album側のガードにより、フィーチャリング曲の同期がこの既存trackにも
      // 一致しうるようになったため、ここでartist_idを含めて更新すると
      // 既存トラックの所有アーティストが上書きされてしまう)
      const { artist_id: _unusedTrackArtistId, ...trackPayloadWithoutArtist } = trackPayload
      const { error: trackUpdateError } = await supabase
        .from('track')
        .update(trackPayloadWithoutArtist)
        .eq('id', existingTrack.id)
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
      await linkOrStubFeaturedArtists(supabase, insertedTrack.id, itunesTrack.trackName)
    }
    trackCount++
  }

  // このアルバムのクレジットをMusicBrainz→Discogsの順で試みる(タイトル完全一致時のみ、
  // ベストエフォート。取得失敗・不一致はアルバム・トラック登録自体には影響させない)。
  // MusicBrainz側は503時に最大5回・1回ごとに1秒以上のリトライを行うため、
  // 混雑時は1アルバムだけで数十秒かかることがある。アルバム数が多いアーティストの
  // 同期(チャンク分割、utils/albumSyncDispatch.ts参照)が1枚のクレジット取込に
  // 詰まって全体が進まなくなるのを防ぐため、それぞれ上限時間で打ち切る。
  // skipCreditImportがtrueの場合はここごと省略する(理由は関数コメント参照)
  if (!skipCreditImport) {
    const albumForCredits = { id: albumId, title: albumPayload.title }
    try {
      await withTimeout(autoImportFromMusicBrainz(supabase, artistId, artistName, albumForCredits, albumTrackList), 5_000)
    } catch (err) {
      console.error(`MusicBrainzクレジット取込に失敗しました(${albumPayload.title}):`, err)
    }
    try {
      await withTimeout(autoImportFromDiscogs(supabase, artistId, artistName, albumForCredits, albumTrackList), 5_000)
    } catch (err) {
      console.error(`Discogsクレジット取込に失敗しました(${albumPayload.title}):`, err)
    }
    // 成功・不一致に関わらず「試行済み」を記録する(scripts/backfill-album-credits.tsが
    // このカラムがNULLのアルバムだけを対象にするため)
    await supabase.from('album').update({ credit_import_attempted_at: new Date().toISOString() }).eq('id', albumId)
  }

  return trackCount
}

/** 検索・選択式の登録UI(app/admin/import/search)や、大量アルバムの一括同期
 * (app/api/admin/album-sync/route.ts)から、1件だけアルバムを登録するための
 * 公開ラッパー。artist_idでの既存判定込みでsyncOneAlbumを呼ぶ。skipCreditImportは
 * syncOneAlbum同様、一括同期でのホップ数削減用(詳細はsyncOneAlbumのコメント参照) */
export async function registerSingleAlbum(
  supabase: SupabaseClient,
  artistId: string,
  artistName: string,
  itunesAlbum: ItunesAlbum,
  skipCreditImport = false,
  country = 'JP'
): Promise<{ trackCount: number }> {
  const { data: existingAlbum } = await supabase
    .from('album')
    .select('id')
    .eq('apple_music_album_id', String(itunesAlbum.collectionId))
    .eq('artist_id', artistId)
    .maybeSingle()

  const trackCount = await syncOneAlbum(
    supabase,
    artistId,
    artistName,
    itunesAlbum,
    existingAlbum?.id ?? null,
    skipCreditImport,
    country
  )
  return { trackCount }
}

/** 配信停止検知: 今回のiTunes取得結果に含まれなかった既存アルバムは削除せず、
 * 「配信停止の可能性」としてステータスだけ更新する(定期的な再同期での運用を想定。
 * 既に/artists/unreleasedページ等で使われているstreaming_status='none'を流用する) */
export async function flagDelistedAlbums(supabase: SupabaseClient, artistId: string, itunesAlbums: ItunesAlbum[]): Promise<void> {
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
  appleMusicArtistId: string,
  country = 'JP'
): Promise<{ newAlbumCount: number; newTrackCount: number }> {
  await fillMissingArtistImage(supabase, artistId, appleMusicArtistId, country)

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
    newTrackCount += await syncOneAlbum(supabase, artistId, artistName, itunesAlbum, null, false, country)
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
  // サーバー関数の実行時間上限を超えて処理が中断される恐れがある。
  // そのためアーティスト本体の登録だけ先に完了させてすぐ結果を返し、
  // アルバム・トラックの取込はafter()でレスポンス後にバックグラウンド実行する
  // (チャンク分割・MusicBrainz取込の連鎖はutils/albumSyncDispatch.ts参照)
  afterOrNow(() => dispatchAlbumSync(artistId, itunesArtist.artistName, String(itunesArtist.artistId), itunesAlbums))

  return {
    success: true,
    sourceUrl: artistUrl,
    message: `「${itunesArtist.artistName}」を登録しました(アルバム${itunesAlbums.length}件は裏で取込中です)。`,
    artistName: itunesArtist.artistName,
    albumCount: itunesAlbums.length,
  }
}