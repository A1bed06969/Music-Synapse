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
    .select('id, title, artist:artist_id(name), album:album_id(title)')
    .ilike('title', `%${trimmed}%`)
    .limit(20)
  return (data ?? []).map((t) => {
    const artist = Array.isArray(t.artist) ? t.artist[0] : t.artist
    const album = Array.isArray(t.album) ? t.album[0] : t.album
    // 同名曲がシングル/EP版とアルバム収録版で別トラック行として存在することがあり
    // (例:「はしりがき」)、アーティスト名だけでは候補を区別できない。
    // どちらの版かを見分けられるよう収録アルバム名も表示する。
    return {
      id: t.id,
      label: `${t.title}${artist?.name ? ` — ${artist.name}` : ''}${album?.title ? `(${album.title})` : ''}`,
    }
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

export async function searchArtists(query: string): Promise<PickerItem[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const supabase = await createClient()
  const { data } = await supabase.from('artist').select('id, name').ilike('name', `%${trimmed}%`).limit(20)
  return (data ?? []).map((a) => ({ id: a.id, label: a.name }))
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
  const pageOverrideRaw = String(formData.get('page_override') ?? '').trim()
  const pageOverride = pageOverrideRaw === 'artist' || pageOverrideRaw === 'member' ? pageOverrideRaw : null

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
      page_override: pageOverride,
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

export async function updateAlbumType(formData: FormData) {
  const albumId = String(formData.get('album_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')
  const albumType = String(formData.get('album_type') ?? '').trim()

  if (!albumId || !albumType) {
    redirectWith('error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('album').update({ album_type: albumType }).eq('id', albumId)

  if (error) {
    redirectWith('error', `更新に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath(`/albums/${albumId}`)
  if (artistId) revalidatePath(`/artists/${artistId}`)
  redirectWith('success', 'アルバムの種別を更新しました。')
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

/** artistのプロフィール項目のうち、統合時に統合先の空欄だけ統合元の値で埋める対象 */
const ARTIST_PROFILE_FILL_COLUMNS = [
  'name_kana',
  'name_en',
  'bio',
  'artist_type',
  'formed_year',
  'origin_prefecture',
  'hometown_city',
  'image_url',
  'official_site_url',
  'sns_x_url',
  'sns_instagram_url',
  'spotify_artist_id',
  'url_latest_mv',
  'apple_music_artist_id',
  'musicbrainz_id',
  'discogs_artist_id',
] as const

/** (source側の行の対象カラム値, targetの既存行群) から、targetに同じ組み合わせが
 * 既にあれば削除、無ければ付け替えるヘルパー。album_artist/artist_credit/artist_genre
 * のような、artist_id込みでUNIQUE制約があるテーブルの重複回避に使う。 */
async function reassignOrDropDuplicates(
  supabase: ReturnType<typeof createAdminClient>,
  table: string,
  idColumn: string,
  sourceRows: { id: string | number; dedupeKey: string }[],
  targetDedupeKeys: Set<string>,
  targetId: string,
  artistColumn: string
) {
  for (const row of sourceRows) {
    if (targetDedupeKeys.has(row.dedupeKey)) {
      await supabase.from(table).delete().eq(idColumn, row.id)
    } else {
      await supabase.from(table).update({ [artistColumn]: targetId }).eq(idColumn, row.id)
      targetDedupeKeys.add(row.dedupeKey)
    }
  }
}

/** 表記違い・自動登録/手動登録の重複などで別々の行になってしまったアーティストを
 * 1件へ統合する。統合元に紐づく全データ(アルバム・トラック・ジャンル・関係性・
 * フェス出演歴・受賞歴・クレジット等、artist_idを外部キーに持つ全19テーブル)を
 * 統合先へ付け替え、UNIQUE制約に抵触しうる組み合わせ(album_artist/artist_genre/
 * artist_credit/artist_relation)は統合先に同じ組み合わせが既にあれば重複させず
 * 削除する。統合元のプロフィール項目は、統合先が未設定の項目だけ埋める
 * (既存値は上書きしない)。最後に統合元のアーティスト行を削除する(取り消せない)。*/
export async function mergeArtist(formData: FormData) {
  let sourceId = String(formData.get('source_artist_id') ?? '')
  let targetId = String(formData.get('target_artist_id') ?? '')

  if (!sourceId || !targetId || sourceId === targetId) {
    redirectWith('error', '統合元と統合先には異なるアーティストを選んでください。')
  }

  const supabase = createAdminClient()

  type ArtistProfileRow = { id: string; name: string } & Record<(typeof ARTIST_PROFILE_FILL_COLUMNS)[number], string | number | null>

  // ARTIST_PROFILE_FILL_COLUMNSはselect文字列を動的に組み立てるための配列だが、
  // テンプレートリテラルで結合するとSupabaseクライアントの型パーサーが列名を
  // 静的に解決できずParserError型になる(utils/artistAlbumQuery.tsで対処した
  // 事例と同種)。selectは列挙のまま書き、戻り値の型だけ配列と明示的に対応付ける。
  const { data: rows } = await supabase
    .from('artist')
    .select(
      'id, name, name_kana, name_en, bio, artist_type, formed_year, origin_prefecture, hometown_city, image_url, official_site_url, sns_x_url, sns_instagram_url, spotify_artist_id, url_latest_mv, apple_music_artist_id, musicbrainz_id, discogs_artist_id'
    )
    .in('id', [sourceId, targetId])
  const typedRows = (rows ?? []) as unknown as ArtistProfileRow[]
  const bySource = typedRows.find((r) => r.id === sourceId)
  const byTarget = typedRows.find((r) => r.id === targetId)

  if (!bySource || !byTarget) {
    redirectWith('error', '指定のアーティストが見つかりませんでした。')
  }
  let source = bySource!
  let target = byTarget!

  // 自動登録(Apple Music取込済み)側の方が今後も新譜同期などで更新され続けるため、
  // 基本的にそちらを統合先にする。統合元にだけapple_music_artist_idが
  // 設定されている場合は、フォームでの選択に関わらず自動的に向きを入れ替える。
  if (source.apple_music_artist_id && !target.apple_music_artist_id) {
    ;[sourceId, targetId] = [targetId, sourceId]
    ;[source, target] = [target, source]
  }

  const metaFill: Record<string, string | number> = {}
  for (const col of ARTIST_PROFILE_FILL_COLUMNS) {
    const targetValue = (target as Record<string, unknown>)[col]
    const sourceValue = (source as Record<string, unknown>)[col]
    if ((targetValue === null || targetValue === undefined) && sourceValue !== null && sourceValue !== undefined) {
      metaFill[col] = sourceValue as string | number
    }
  }
  if (Object.keys(metaFill).length > 0) {
    await supabase.from('artist').update(metaFill).eq('id', targetId)
  }

  // album.artist_id / track.artist_id: 組み合わせのUNIQUE制約は無いため単純に付け替える
  // (先にこれを終わらせておく必要がある。album/trackはON DELETE RESTRICT/CASCADEのため、
  // 付け替え前に統合元を削除するとエラーになるか、意図せずレコードごと消えてしまう)
  await supabase.from('album').update({ artist_id: targetId }).eq('artist_id', sourceId)
  await supabase.from('track').update({ artist_id: targetId }).eq('artist_id', sourceId)

  // artist_genre: PK(artist_id, genre_id)
  const [{ data: sourceGenres }, { data: targetGenres }] = await Promise.all([
    supabase.from('artist_genre').select('genre_id').eq('artist_id', sourceId),
    supabase.from('artist_genre').select('genre_id').eq('artist_id', targetId),
  ])
  const targetGenreIds = new Set((targetGenres ?? []).map((r) => r.genre_id))
  for (const row of sourceGenres ?? []) {
    if (targetGenreIds.has(row.genre_id)) {
      await supabase.from('artist_genre').delete().eq('artist_id', sourceId).eq('genre_id', row.genre_id)
    } else {
      await supabase
        .from('artist_genre')
        .update({ artist_id: targetId })
        .eq('artist_id', sourceId)
        .eq('genre_id', row.genre_id)
      targetGenreIds.add(row.genre_id)
    }
  }

  // album_artist: UNIQUE(album_id, artist_id)。統合先が既にそのアルバムの
  // 代表アーティスト(album.artist_id、直前で付け替え済み)になっているケースも
  // 自己参照になってしまうため除外する
  const [{ data: sourceAlbumArtists }, { data: targetAlbumArtists }, { data: targetOwnedAlbums }] = await Promise.all([
    supabase.from('album_artist').select('id, album_id').eq('artist_id', sourceId),
    supabase.from('album_artist').select('album_id').eq('artist_id', targetId),
    supabase.from('album').select('id').eq('artist_id', targetId),
  ])
  const targetAlbumIds = new Set((targetAlbumArtists ?? []).map((r) => r.album_id))
  const targetOwnedAlbumIds = new Set((targetOwnedAlbums ?? []).map((r) => r.id))
  await reassignOrDropDuplicates(
    supabase,
    'album_artist',
    'id',
    (sourceAlbumArtists ?? [])
      .filter((r) => !targetOwnedAlbumIds.has(r.album_id))
      .map((r) => ({ id: r.id, dedupeKey: r.album_id })),
    targetAlbumIds,
    targetId,
    'artist_id'
  )
  // 統合先が既に代表アーティストのアルバムへの重複紐付けは、付け替えず削除する
  const selfRefAlbumArtistIds = (sourceAlbumArtists ?? [])
    .filter((r) => targetOwnedAlbumIds.has(r.album_id))
    .map((r) => r.id)
  if (selfRefAlbumArtistIds.length > 0) {
    await supabase.from('album_artist').delete().in('id', selfRefAlbumArtistIds)
  }

  // artist_credit: UNIQUE(artist_id, album_id, track_id, credit_person_id, role, source, instrument_id)
  const [{ data: sourceCredits }, { data: targetCredits }] = await Promise.all([
    supabase
      .from('artist_credit')
      .select('id, album_id, track_id, credit_person_id, role, source, instrument_id')
      .eq('artist_id', sourceId),
    supabase
      .from('artist_credit')
      .select('album_id, track_id, credit_person_id, role, source, instrument_id')
      .eq('artist_id', targetId),
  ])
  const creditKey = (r: { album_id: string; track_id: string | null; credit_person_id: string; role: string; source: string; instrument_id: string | null }) =>
    [r.album_id, r.track_id, r.credit_person_id, r.role, r.source, r.instrument_id].join('|')
  const targetCreditKeys = new Set((targetCredits ?? []).map(creditKey))
  await reassignOrDropDuplicates(
    supabase,
    'artist_credit',
    'id',
    (sourceCredits ?? []).map((r) => ({ id: r.id, dedupeKey: creditKey(r) })),
    targetCreditKeys,
    targetId,
    'artist_id'
  )

  // artist_relation: UNIQUE(artist_id_a, artist_id_b, relation_type)。片方の列だけ
  // 統合元を指している行と、両方の列がそれぞれ統合元・統合先を指す行(付け替えると
  // 自己参照 a=b になる行)の両方がありうる
  const { data: sourceRelations } = await supabase
    .from('artist_relation')
    .select('id, artist_id_a, artist_id_b, relation_type')
    .or(`artist_id_a.eq.${sourceId},artist_id_b.eq.${sourceId}`)
  const { data: targetRelations } = await supabase
    .from('artist_relation')
    .select('artist_id_a, artist_id_b, relation_type')
    .or(`artist_id_a.eq.${targetId},artist_id_b.eq.${targetId}`)
  const targetRelationKeys = new Set(
    (targetRelations ?? []).map((r) => [r.artist_id_a, r.artist_id_b, r.relation_type].join('|'))
  )
  for (const row of sourceRelations ?? []) {
    const newA = row.artist_id_a === sourceId ? targetId : row.artist_id_a
    const newB = row.artist_id_b === sourceId ? targetId : row.artist_id_b
    const key = [newA, newB, row.relation_type].join('|')
    if (newA === newB || targetRelationKeys.has(key)) {
      await supabase.from('artist_relation').delete().eq('id', row.id)
    } else {
      await supabase.from('artist_relation').update({ artist_id_a: newA, artist_id_b: newB }).eq('id', row.id)
      targetRelationKeys.add(key)
    }
  }

  // event_appearance: DB制約は無いが(event_edition_id, artist_id)を実質ユニークとして
  // 扱っているため、統合先に同じ開催回への出演が既にある場合は重複させず削除する
  const [{ data: sourceAppearances }, { data: targetAppearances }] = await Promise.all([
    supabase.from('event_appearance').select('id, event_edition_id').eq('artist_id', sourceId),
    supabase.from('event_appearance').select('event_edition_id').eq('artist_id', targetId),
  ])
  const targetEditionIds = new Set((targetAppearances ?? []).map((r) => r.event_edition_id))
  await reassignOrDropDuplicates(
    supabase,
    'event_appearance',
    'id',
    (sourceAppearances ?? []).map((r) => ({ id: r.id, dedupeKey: r.event_edition_id })),
    targetEditionIds,
    targetId,
    'artist_id'
  )

  // event_appearance_artist: UNIQUE(event_appearance_id, artist_id)。コラボ出演で
  // 統合元・統合先が同じevent_appearanceに両方紐づいている場合(同じフェスへの
  // 別名義出演が実は同一人物だった等)は重複させず削除する
  const [{ data: sourceApArtistLinks }, { data: targetApArtistLinks }] = await Promise.all([
    supabase.from('event_appearance_artist').select('id, event_appearance_id').eq('artist_id', sourceId),
    supabase.from('event_appearance_artist').select('event_appearance_id').eq('artist_id', targetId),
  ])
  const targetApArtistAppearanceIds = new Set((targetApArtistLinks ?? []).map((r) => r.event_appearance_id))
  await reassignOrDropDuplicates(
    supabase,
    'event_appearance_artist',
    'id',
    (sourceApArtistLinks ?? []).map((r) => ({ id: r.id, dedupeKey: r.event_appearance_id })),
    targetApArtistAppearanceIds,
    targetId,
    'artist_id'
  )

  // artist_external_link: UNIQUE(artist_id, link_type, url)。MusicBrainzプロフィール
  // 自動取込等で同じリンクが両方の行に付いていることが多いため、重複は付け替えず削除する
  // (実際にCibo Matto/CIBO MATTOの統合で遭遇: 付け替えが制約違反で失敗し、統合元の削除が
  // 外部キー違反で失敗する不具合があった。エラーを握りつぶさず必ず確認すること)
  const [{ data: sourceLinks }, { data: targetLinks }] = await Promise.all([
    supabase.from('artist_external_link').select('id, link_type, url').eq('artist_id', sourceId),
    supabase.from('artist_external_link').select('link_type, url').eq('artist_id', targetId),
  ])
  const linkKey = (r: { link_type: string; url: string }) => [r.link_type, r.url].join('|')
  const targetLinkKeys = new Set((targetLinks ?? []).map(linkKey))
  await reassignOrDropDuplicates(
    supabase,
    'artist_external_link',
    'id',
    (sourceLinks ?? []).map((r) => ({ id: r.id, dedupeKey: linkKey(r) })),
    targetLinkKeys,
    targetId,
    'artist_id'
  )

  // 残りのテーブルはartist_id込みのUNIQUE制約が無いため単純に付け替えるだけでよい
  // (多少の重複が残っても表示上の実害は無く、DBエラーにもならない)。
  // ここでのUPDATE失敗を握りつぶすと、後段のDELETEが外部キー違反で失敗し
  // 「一部だけ付け替わった中途半端な状態」に陥る(実際に発生した不具合)ため、
  // エラーは必ず確認して途中で打ち切る
  const simpleReassignTables = [
    'radio_rotation',
    'music_event',
    'setlist',
    'contest_entry',
    'award_entry',
    'ranking_entry',
    'artist_label',
    'person_artist_relation',
    'track_artist',
    'genre_highlight',
  ] as const
  for (const table of simpleReassignTables) {
    const { error: reassignError } = await supabase.from(table).update({ artist_id: targetId }).eq('artist_id', sourceId)
    if (reassignError) {
      redirectWith(
        'error',
        `${table}の付け替えに失敗しました(統合元は削除されていません): ${reassignError.message}`
      )
    }
  }

  const { error: deleteError } = await supabase.from('artist').delete().eq('id', sourceId)
  if (deleteError) {
    redirectWith('error', `統合元の削除に失敗しました(データの付け替えは完了しています): ${deleteError.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath(`/artists/${targetId}`)
  redirectWith('success', `「${source.name}」を「${target.name}」へ統合しました。`)
}
