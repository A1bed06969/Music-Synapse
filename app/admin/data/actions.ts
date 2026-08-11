'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'
import { createClient } from '@/utils/Supabase/server'
import { PREFECTURE_COORDS } from '@/utils/prefectures'
import { extractSpotifyTrackId, extractYoutubeVideoId } from '@/utils/format'

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

const RELATION_STYLE_BY_TYPE: Record<string, 'solid' | 'dotted'> = {
  membership: 'solid',
  production: 'solid',
  collaboration: 'solid',
  genre_scene: 'dotted',
  influence: 'dotted',
  sync_costar: 'dotted',
}

function redirectWith(result: 'success' | 'error', message: string) {
  redirect(`/admin/data?${result}=${encodeURIComponent(message)}`)
}

export async function createGenre(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const originYearRaw = String(formData.get('origin_year') ?? '').trim()

  if (!name) {
    redirectWith('error', 'ジャンル名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('genre').insert({
    name,
    origin_year: originYearRaw ? Number(originYearRaw) : null,
  })

  if (error) {
    redirectWith('error', `ジャンルの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  redirectWith('success', `ジャンル「${name}」を登録しました。`)
}

export async function linkArtistGenre(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')
  const genreId = String(formData.get('genre_id') ?? '')

  if (!artistId || !genreId) {
    redirectWith('error', 'アーティストとジャンルを選択してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('artist_genre').upsert({ artist_id: artistId, genre_id: genreId })

  if (error) {
    redirectWith('error', `ジャンルの紐付けに失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath('/relations')
  redirectWith('success', 'アーティストにジャンルを紐付けました。')
}

export async function createRelation(formData: FormData) {
  const artistIdA = String(formData.get('artist_id_a') ?? '')
  const artistIdB = String(formData.get('artist_id_b') ?? '')
  const relationType = String(formData.get('relation_type') ?? '')
  const description = String(formData.get('description') ?? '').trim()

  if (!artistIdA || !artistIdB || !relationType) {
    redirectWith('error', 'アーティスト2件と関係の種類を選択してください。')
  }
  if (artistIdA === artistIdB) {
    redirectWith('error', '異なる2人のアーティストを選択してください。')
  }

  const relationStyle = RELATION_STYLE_BY_TYPE[relationType]

  const [artist_id_a, artist_id_b] = [artistIdA, artistIdB].sort()

  const supabase = createAdminClient()
  const { error } = await supabase.from('artist_relation').upsert(
    {
      artist_id_a,
      artist_id_b,
      relation_type: relationType,
      relation_style: relationStyle,
      description: description || null,
    },
    { onConflict: 'artist_id_a,artist_id_b,relation_type', ignoreDuplicates: true }
  )

  if (error) {
    redirectWith('error', `相関データの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath('/relations')
  redirectWith('success', '相関データを登録しました。')
}

export async function createLabel(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const nameKana = String(formData.get('name_kana') ?? '').trim()
  const foundedYearRaw = String(formData.get('founded_year') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()

  if (!name) {
    redirectWith('error', 'レーベル名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('label').insert({
    name,
    name_kana: nameKana || null,
    founded_year: foundedYearRaw ? Number(foundedYearRaw) : null,
    description: description || null,
  })

  if (error) {
    redirectWith('error', `レーベルの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  redirectWith('success', `レーベル「${name}」を登録しました。`)
}

export async function linkArtistLabel(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')
  const labelId = String(formData.get('label_id') ?? '')
  const startDate = String(formData.get('start_date') ?? '').trim()

  if (!artistId || !labelId) {
    redirectWith('error', 'アーティストとレーベルを選択してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('artist_label').insert({
    artist_id: artistId,
    label_id: labelId,
    start_date: startDate || null,
  })

  if (error) {
    redirectWith('error', `レーベルの紐付けに失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  redirectWith('success', 'アーティストにレーベルを紐付けました。')
}

export async function linkAlbumLabel(formData: FormData) {
  const albumId = String(formData.get('album_id') ?? '')
  const labelId = String(formData.get('label_id') ?? '')

  if (!albumId || !labelId) {
    redirectWith('error', 'アルバムとレーベルを選択してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('album').update({ label_id: labelId }).eq('id', albumId)

  if (error) {
    redirectWith('error', `アルバムのレーベル紐付けに失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath(`/labels/${labelId}`)
  revalidatePath(`/albums/${albumId}`)
  redirectWith('success', 'アルバムにレーベルを紐付けました。')
}

export async function createMedia(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const mediaType = String(formData.get('media_type') ?? '').trim()
  const area = String(formData.get('area') ?? '').trim()
  const prefecture = String(formData.get('prefecture') ?? '').trim()
  const validPrefecture = PREFECTURE_COORDS.some((p) => p.name === prefecture) ? prefecture : null

  if (!name) {
    redirectWith('error', 'メディア名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('media').insert({
    name,
    media_type: mediaType || null,
    area: area || null,
    prefecture: validPrefecture,
  })

  if (error) {
    redirectWith('error', `メディアの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  redirectWith('success', `メディア「${name}」を登録しました。`)
}

export async function createMediaProgram(formData: FormData) {
  const mediaId = String(formData.get('media_id') ?? '')
  const programName = String(formData.get('program_name') ?? '').trim()
  const periodType = String(formData.get('period_type') ?? '')

  if (!mediaId || !programName || !periodType) {
    redirectWith('error', 'メディア・番組名・集計周期を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('media_program').insert({
    media_id: mediaId,
    program_name: programName,
    period_type: periodType,
  })

  if (error) {
    redirectWith('error', `番組の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  redirectWith('success', `番組「${programName}」を登録しました。`)
}

export async function createRadioRotation(formData: FormData) {
  const mediaProgramId = String(formData.get('media_program_id') ?? '')
  const periodType = String(formData.get('period_type') ?? '')
  const periodStartDate = String(formData.get('period_start_date') ?? '')
  const musicType = String(formData.get('music_type') ?? '')
  const trackId = String(formData.get('track_id') ?? '')
  const albumId = String(formData.get('album_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')
  const note = String(formData.get('note') ?? '').trim()

  if (!mediaProgramId || !periodType || !periodStartDate || !musicType) {
    redirectWith('error', '番組・集計周期・対象期間・邦楽/洋楽を入力してください。')
  }

  const targetCount = [trackId, albumId, artistId].filter(Boolean).length
  if (targetCount !== 1) {
    redirectWith('error', 'プッシュ対象は「トラック」「アルバム」「アーティスト」のうちどれか1つだけ選んでください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('radio_rotation').insert({
    media_program_id: mediaProgramId,
    period_type: periodType,
    period_start_date: periodStartDate,
    music_type: musicType,
    track_id: trackId || null,
    album_id: albumId || null,
    artist_id: artistId || null,
    note: note || null,
  })

  if (error) {
    redirectWith('error', `オンエアデータの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath('/media/on-air')
  redirectWith('success', 'オンエアデータを登録しました。')
}

export async function createRanking(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const mediaId = String(formData.get('media_id') ?? '')
  const source = String(formData.get('source') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()

  if (!name) {
    redirectWith('error', '企画名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('ranking').insert({
    name,
    media_id: mediaId || null,
    source: source || null,
    description: description || null,
  })

  if (error) {
    redirectWith('error', `企画の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath('/media/features')
  redirectWith('success', `企画「${name}」を登録しました。`)
}

export async function createRankingEntry(formData: FormData) {
  const rankingId = String(formData.get('ranking_id') ?? '')
  const rank = String(formData.get('rank') ?? '').trim()
  const periodDate = String(formData.get('period_date') ?? '').trim()
  const metricValue = String(formData.get('metric_value') ?? '').trim()
  const metricLabel = String(formData.get('metric_label') ?? '').trim()
  const trackId = String(formData.get('track_id') ?? '')
  const albumId = String(formData.get('album_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')

  if (!rankingId || !rank || !periodDate) {
    redirectWith('error', '企画・順位・日付を入力してください。')
  }

  const targetCount = [trackId, albumId, artistId].filter(Boolean).length
  if (targetCount !== 1) {
    redirectWith('error', '対象は「トラック」「アルバム」「アーティスト」のうちどれか1つだけ選んでください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('ranking_entry').insert({
    ranking_id: rankingId,
    rank: Number(rank),
    period_date: periodDate,
    metric_value: metricValue ? Number(metricValue) : null,
    metric_label: metricLabel || null,
    track_id: trackId || null,
    album_id: albumId || null,
    artist_id: artistId || null,
  })

  if (error) {
    redirectWith('error', `ランクインデータの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath(`/media/features/${rankingId}`)
  redirectWith('success', 'ランクインデータを登録しました。')
}

export async function createSyncWork(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim()
  const workType = String(formData.get('work_type') ?? '')
  const companyOrStudio = String(formData.get('company_or_studio') ?? '').trim()
  const yearRaw = String(formData.get('year') ?? '').trim()

  if (!title) {
    redirectWith('error', '作品名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('sync_work').insert({
    title,
    work_type: workType || null,
    company_or_studio: companyOrStudio || null,
    year: yearRaw ? Number(yearRaw) : null,
  })

  if (error) {
    redirectWith('error', `作品の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath('/media/sync')
  redirectWith('success', `作品「${title}」を登録しました。`)
}

export async function createSyncEntry(formData: FormData) {
  const syncWorkId = String(formData.get('sync_work_id') ?? '')
  const trackId = String(formData.get('track_id') ?? '')
  const usageDetail = String(formData.get('usage_detail') ?? '').trim()

  if (!syncWorkId || !trackId) {
    redirectWith('error', '作品とトラックを選択してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('sync_entry').insert({
    sync_work_id: syncWorkId,
    track_id: trackId,
    usage_detail: usageDetail || null,
  })

  if (error) {
    redirectWith('error', `起用楽曲の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath(`/media/sync/${syncWorkId}`)
  redirectWith('success', '起用楽曲を登録しました。')
}

export async function createAward(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const country = String(formData.get('country') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()

  if (!name) {
    redirectWith('error', '賞名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('award').insert({
    name,
    country: country || null,
    description: description || null,
  })

  if (error) {
    redirectWith('error', `賞の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath('/chronology/awards')
  redirectWith('success', `「${name}」を登録しました。`)
}

export async function createAwardEntry(formData: FormData) {
  const awardId = String(formData.get('award_id') ?? '')
  const year = String(formData.get('year') ?? '').trim()
  const category = String(formData.get('category') ?? '').trim()
  const result = String(formData.get('result') ?? '')
  const trackId = String(formData.get('track_id') ?? '')
  const albumId = String(formData.get('album_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')

  if (!awardId || !year || !result) {
    redirectWith('error', '賞・年・結果を入力してください。')
  }

  const targetCount = [trackId, albumId, artistId].filter(Boolean).length
  if (targetCount !== 1) {
    redirectWith('error', '対象は「トラック」「アルバム」「アーティスト」のうちどれか1つだけ選んでください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('award_entry').insert({
    award_id: awardId,
    year: Number(year),
    category: category || null,
    result,
    track_id: trackId || null,
    album_id: albumId || null,
    artist_id: artistId || null,
  })

  if (error) {
    redirectWith('error', `受賞・ノミネートの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath('/chronology/awards')
  if (artistId) revalidatePath(`/artists/${artistId}`)
  redirectWith('success', '受賞・ノミネートを登録しました。')
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

export async function createEvent(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const eventType = String(formData.get('event_type') ?? '').trim()
  const foundedYearRaw = String(formData.get('founded_year') ?? '').trim()
  const country = String(formData.get('country') ?? '').trim()
  const prefecture = String(formData.get('prefecture') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()

  if (!name) {
    redirectWith('error', 'イベント名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('event').insert({
    name,
    event_type: eventType || null,
    founded_year: foundedYearRaw ? Number(foundedYearRaw) : null,
    country: country || null,
    prefecture: prefecture || null,
    description: description || null,
  })

  if (error) {
    redirectWith('error', `イベントの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  redirectWith('success', `イベント「${name}」を登録しました。`)
}

export async function createEventEdition(formData: FormData) {
  const eventId = String(formData.get('event_id') ?? '')
  const yearRaw = String(formData.get('year') ?? '').trim()
  const startDate = String(formData.get('start_date') ?? '').trim()
  const endDate = String(formData.get('end_date') ?? '').trim()
  const venue = String(formData.get('venue') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()

  if (!eventId || !yearRaw) {
    redirectWith('error', 'イベントと年を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('event_edition').insert({
    event_id: eventId,
    year: Number(yearRaw),
    start_date: startDate || null,
    end_date: endDate || null,
    venue: venue || null,
    description: description || null,
  })

  if (error) {
    redirectWith('error', `開催回の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  redirectWith('success', '開催回を登録しました。')
}

export async function createEventAppearance(formData: FormData) {
  const eventEditionId = String(formData.get('event_edition_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')
  const stage = String(formData.get('stage') ?? '').trim()
  const venue = String(formData.get('venue') ?? '').trim()
  const startTime = String(formData.get('start_time') ?? '').trim()
  const endTime = String(formData.get('end_time') ?? '').trim()
  const isHeadliner = formData.get('is_headliner') === 'on'

  if (!eventEditionId || !artistId) {
    redirectWith('error', '開催回とアーティストを選択してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('event_appearance').insert({
    event_edition_id: eventEditionId,
    artist_id: artistId,
    stage: stage || null,
    venue: venue || null,
    // datetime-local からの入力はタイムゾーン情報を持たないため、日本時間として保存する
    start_time: startTime ? `${startTime}:00+09:00` : null,
    end_time: endTime ? `${endTime}:00+09:00` : null,
    is_headliner: isHeadliner,
  })

  if (error) {
    redirectWith('error', `出演情報の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath(`/artists/${artistId}`)
  redirectWith('success', '出演情報を登録しました。')
}

export async function createMusicEvent(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const eventDate = String(formData.get('event_date') ?? '').trim()
  const venue = String(formData.get('venue') ?? '').trim()
  const prefecture = String(formData.get('prefecture') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()

  if (!artistId || !name) {
    redirectWith('error', 'アーティストと公演名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('music_event').insert({
    artist_id: artistId,
    name,
    event_date: eventDate || null,
    venue: venue || null,
    prefecture: prefecture || null,
    description: description || null,
  })

  if (error) {
    redirectWith('error', `単独公演の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data')
  revalidatePath(`/artists/${artistId}`)
  redirectWith('success', `単独公演「${name}」を登録しました。`)
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
