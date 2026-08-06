'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'
import { PREFECTURE_COORDS } from '@/utils/prefectures'

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

  const supabase = createAdminClient()
  const { error } = await supabase.from('artist_relation').insert({
    artist_id_a: artistIdA,
    artist_id_b: artistIdB,
    relation_type: relationType,
    relation_style: relationStyle,
    description: description || null,
  })

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
