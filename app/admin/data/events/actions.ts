'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'
import {
  fetchFestivalPageHtml,
  extractOgImage,
  stripHtmlToText,
  extractFestivalLineupWithGemini,
  type FestivalLineupCandidate,
} from '@/utils/geminiFestivalLineupExtract'

function redirectWith(result: 'success' | 'error', message: string) {
  redirect(`/admin/data/events?${result}=${encodeURIComponent(message)}`)
}

export async function createEvent(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const nameJa = String(formData.get('name_ja') ?? '').trim()
  const eventType = String(formData.get('event_type') ?? '').trim()
  const foundedYearRaw = String(formData.get('founded_year') ?? '').trim()
  const country = String(formData.get('country') ?? '').trim()
  const prefecture = String(formData.get('prefecture') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  const genreId = String(formData.get('genre_id') ?? '').trim()
  const imageUrl = String(formData.get('image_url') ?? '').trim()
  const officialSiteUrl = String(formData.get('official_site_url') ?? '').trim()
  const officialYoutubeUrl = String(formData.get('official_youtube_url') ?? '').trim()

  if (!name) {
    redirectWith('error', 'イベント名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('event').insert({
    name,
    name_ja: nameJa || null,
    event_type: eventType || null,
    founded_year: foundedYearRaw ? Number(foundedYearRaw) : null,
    country: country || null,
    prefecture: prefecture || null,
    description: description || null,
    genre_id: genreId || null,
    image_url: imageUrl || null,
    official_site_url: officialSiteUrl || null,
    official_youtube_url: officialYoutubeUrl || null,
  })

  if (error) {
    redirectWith('error', `イベントの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/events')
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

  revalidatePath('/admin/data/events')
  redirectWith('success', '開催回を登録しました。')
}

export async function createEventEditionDate(formData: FormData) {
  const eventEditionId = String(formData.get('event_edition_id') ?? '')
  const date = String(formData.get('date') ?? '').trim()
  const venue = String(formData.get('venue') ?? '').trim()
  const region = String(formData.get('region') ?? '').trim()

  if (!eventEditionId || !date || !venue) {
    redirectWith('error', '開催回・日付・会場を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('event_edition_date').insert({
    event_edition_id: eventEditionId,
    date,
    venue,
    region: region || null,
  })

  if (error) {
    redirectWith('error', `開催日程の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/events')
  revalidatePath('/albums/calendar')
  redirectWith('success', '開催日程を登録しました。')
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
  const { data: inserted, error } = await supabase
    .from('event_appearance')
    .insert({
      event_edition_id: eventEditionId,
      artist_id: artistId,
      stage: stage || null,
      venue: venue || null,
      // datetime-local からの入力はタイムゾーン情報を持たないため、日本時間として保存する
      start_time: startTime ? `${startTime}:00+09:00` : null,
      end_time: endTime ? `${endTime}:00+09:00` : null,
      is_headliner: isHeadliner,
    })
    .select('id')
    .single()

  if (error || !inserted) {
    redirectWith('error', `出演情報の登録に失敗しました: ${error?.message}`)
  }

  // アーティストページ側はevent_appearance_artist経由でのみ出演を引くため、
  // ここで作成した行も必ず紐づけておく(単独出演でも1件登録する)
  const { error: linkError } = await supabase
    .from('event_appearance_artist')
    .insert({ event_appearance_id: inserted!.id, artist_id: artistId, billing_order: 0 })
  if (linkError) {
    redirectWith('error', `出演情報のアーティスト紐付けに失敗しました: ${linkError.message}`)
  }

  revalidatePath('/admin/data/events')
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

  revalidatePath('/admin/data/events')
  revalidatePath(`/artists/${artistId}`)
  redirectWith('success', `単独公演「${name}」を登録しました。`)
}

export async function updateEvent(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const nameJa = String(formData.get('name_ja') ?? '').trim()
  const eventType = String(formData.get('event_type') ?? '').trim()
  const foundedYearRaw = String(formData.get('founded_year') ?? '').trim()
  const country = String(formData.get('country') ?? '').trim()
  const prefecture = String(formData.get('prefecture') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  const genreId = String(formData.get('genre_id') ?? '').trim()
  const imageUrl = String(formData.get('image_url') ?? '').trim()
  const officialSiteUrl = String(formData.get('official_site_url') ?? '').trim()
  const officialYoutubeUrl = String(formData.get('official_youtube_url') ?? '').trim()

  if (!id || !name) {
    redirectWith('error', 'イベント名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('event')
    .update({
      name,
      name_ja: nameJa || null,
      event_type: eventType || null,
      founded_year: foundedYearRaw ? Number(foundedYearRaw) : null,
      country: country || null,
      prefecture: prefecture || null,
      description: description || null,
      genre_id: genreId || null,
      image_url: imageUrl || null,
      official_site_url: officialSiteUrl || null,
      official_youtube_url: officialYoutubeUrl || null,
    })
    .eq('id', id)

  if (error) {
    redirectWith('error', `イベントの更新に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/events')
  redirectWith('success', `イベント「${name}」を更新しました。`)
}

export async function deleteEvent(formData: FormData) {
  const id = String(formData.get('id') ?? '')

  if (!id) {
    redirectWith('error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('event').delete().eq('id', id)

  if (error) {
    redirectWith('error', `削除に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/events')
  redirectWith('success', 'イベントを削除しました。')
}

export async function updateEventEdition(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const eventId = String(formData.get('event_id') ?? '')
  const yearRaw = String(formData.get('year') ?? '').trim()
  const startDate = String(formData.get('start_date') ?? '').trim()
  const endDate = String(formData.get('end_date') ?? '').trim()
  const venue = String(formData.get('venue') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()

  if (!id || !eventId || !yearRaw) {
    redirectWith('error', 'イベントと年を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('event_edition')
    .update({
      event_id: eventId,
      year: Number(yearRaw),
      start_date: startDate || null,
      end_date: endDate || null,
      venue: venue || null,
      description: description || null,
    })
    .eq('id', id)

  if (error) {
    redirectWith('error', `開催回の更新に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/events')
  revalidatePath('/albums/calendar')
  redirectWith('success', '開催回を更新しました。')
}

export async function deleteEventEdition(formData: FormData) {
  const id = String(formData.get('id') ?? '')

  if (!id) {
    redirectWith('error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('event_edition').delete().eq('id', id)

  if (error) {
    redirectWith('error', `削除に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/events')
  revalidatePath('/albums/calendar')
  redirectWith('success', '開催回を削除しました。')
}

export async function updateEventEditionDate(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const eventEditionId = String(formData.get('event_edition_id') ?? '')
  const date = String(formData.get('date') ?? '').trim()
  const venue = String(formData.get('venue') ?? '').trim()
  const region = String(formData.get('region') ?? '').trim()

  if (!id || !eventEditionId || !date || !venue) {
    redirectWith('error', '開催回・日付・会場を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('event_edition_date')
    .update({ event_edition_id: eventEditionId, date, venue, region: region || null })
    .eq('id', id)

  if (error) {
    redirectWith('error', `開催日程の更新に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/events')
  revalidatePath('/albums/calendar')
  redirectWith('success', '開催日程を更新しました。')
}

export async function deleteEventEditionDate(formData: FormData) {
  const id = String(formData.get('id') ?? '')

  if (!id) {
    redirectWith('error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('event_edition_date').delete().eq('id', id)

  if (error) {
    redirectWith('error', `削除に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/events')
  revalidatePath('/albums/calendar')
  redirectWith('success', '開催日程を削除しました。')
}

export async function updateEventAppearance(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const eventEditionId = String(formData.get('event_edition_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')
  const stage = String(formData.get('stage') ?? '').trim()
  const venue = String(formData.get('venue') ?? '').trim()
  const startTime = String(formData.get('start_time') ?? '').trim()
  const endTime = String(formData.get('end_time') ?? '').trim()
  const isHeadliner = formData.get('is_headliner') === 'on'

  if (!id || !eventEditionId || !artistId) {
    redirectWith('error', '開催回とアーティストを選択してください。')
  }

  const displayName = String(formData.get('display_name') ?? '').trim()

  const supabase = createAdminClient()
  const { data: before } = await supabase.from('event_appearance').select('artist_id').eq('id', id).single()

  const { error } = await supabase
    .from('event_appearance')
    .update({
      event_edition_id: eventEditionId,
      artist_id: artistId,
      stage: stage || null,
      venue: venue || null,
      start_time: startTime ? `${startTime}:00+09:00` : null,
      end_time: endTime ? `${endTime}:00+09:00` : null,
      is_headliner: isHeadliner,
      display_name: displayName || null,
    })
    .eq('id', id)

  if (error) {
    redirectWith('error', `出演情報の更新に失敗しました: ${error.message}`)
  }

  // 代表アーティストを差し替えた場合、event_appearance_artist側の代表行
  // (billing_order=0)も追従させる(そうしないと旧アーティストのページに
  // 出演情報が残り続け、新アーティストのページには反映されない)
  if (before && before.artist_id !== artistId) {
    await supabase
      .from('event_appearance_artist')
      .update({ artist_id: artistId })
      .eq('event_appearance_id', id)
      .eq('artist_id', before.artist_id)
      .eq('billing_order', 0)
  }

  revalidatePath('/admin/data/events')
  revalidatePath(`/admin/data/events/appearance/${id}/edit`)
  revalidatePath(`/artists/${artistId}`)
  if (before && before.artist_id !== artistId) revalidatePath(`/artists/${before.artist_id}`)
  redirectWith('success', '出演情報を更新しました。')
}

function redirectToEdit(appearanceId: string, result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/events/appearance/${appearanceId}/edit?${result}=${encodeURIComponent(message)}`)
}

/** コラボ出演に構成アーティストを1名追加する(billing_orderは既存の最大値+1) */
export async function addAppearanceArtist(formData: FormData) {
  const appearanceId = String(formData.get('event_appearance_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')

  if (!appearanceId || !artistId) {
    redirectWith('error', 'アーティストを選択してください。')
  }

  const supabase = createAdminClient()
  const { data: existing } = await supabase
    .from('event_appearance_artist')
    .select('billing_order')
    .eq('event_appearance_id', appearanceId)
    .order('billing_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = (existing?.billing_order ?? -1) + 1

  const { error } = await supabase
    .from('event_appearance_artist')
    .insert({ event_appearance_id: appearanceId, artist_id: artistId, billing_order: nextOrder })

  if (error) {
    redirectToEdit(appearanceId, 'error', `構成アーティストの追加に失敗しました: ${error.message}`)
  }

  revalidatePath(`/admin/data/events/appearance/${appearanceId}/edit`)
  revalidatePath(`/artists/${artistId}`)
  redirectToEdit(appearanceId, 'success', '構成アーティストを追加しました。')
}

/** コラボ出演から構成アーティストを1名外す(最後の1名は外せない=単独出演の
 * event_appearance_artist行を空にはできない) */
export async function removeAppearanceArtist(formData: FormData) {
  const appearanceId = String(formData.get('event_appearance_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')

  if (!appearanceId || !artistId) {
    redirectWith('error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { count } = await supabase
    .from('event_appearance_artist')
    .select('id', { count: 'exact', head: true })
    .eq('event_appearance_id', appearanceId)
  if ((count ?? 0) <= 1) {
    redirectToEdit(appearanceId, 'error', '最後の1名は削除できません(出演情報自体を削除してください)。')
  }

  const { error } = await supabase
    .from('event_appearance_artist')
    .delete()
    .eq('event_appearance_id', appearanceId)
    .eq('artist_id', artistId)

  if (error) {
    redirectToEdit(appearanceId, 'error', `構成アーティストの削除に失敗しました: ${error.message}`)
  }

  revalidatePath(`/admin/data/events/appearance/${appearanceId}/edit`)
  revalidatePath(`/artists/${artistId}`)
  redirectToEdit(appearanceId, 'success', '構成アーティストを削除しました。')
}

export async function deleteEventAppearance(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')

  if (!id) {
    redirectWith('error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('event_appearance').delete().eq('id', id)

  if (error) {
    redirectWith('error', `削除に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/events')
  if (artistId) revalidatePath(`/artists/${artistId}`)
  redirectWith('success', '出演情報を削除しました。')
}

export async function updateMusicEvent(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const eventDate = String(formData.get('event_date') ?? '').trim()
  const venue = String(formData.get('venue') ?? '').trim()
  const prefecture = String(formData.get('prefecture') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()

  if (!id || !artistId || !name) {
    redirectWith('error', 'アーティストと公演名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('music_event')
    .update({
      artist_id: artistId,
      name,
      event_date: eventDate || null,
      venue: venue || null,
      prefecture: prefecture || null,
      description: description || null,
    })
    .eq('id', id)

  if (error) {
    redirectWith('error', `単独公演の更新に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/events')
  revalidatePath(`/artists/${artistId}`)
  redirectWith('success', `単独公演「${name}」を更新しました。`)
}

/** 重複イベント(source)をcanonical(target)へ統合する。festival-pilot経由の
 * 名前完全一致(findOrCreateFestivalEdition)で、既存イベントと微妙に違う名前
 * (例:「Coachella」と「Coachella Festival」)のせいで別イベントが作られて
 * しまうことがあるため、その復旧に使う。event_editionは(event_id, year)が
 * target側に既にあればそちらへevent_appearance/event_edition_date/setlistを
 * 付け替えてsource側のeditionを削除、無ければeditionごとtargetへ付け替える。
 * 取り消せない操作。 */
export async function mergeEvent(formData: FormData) {
  const sourceId = String(formData.get('source_event_id') ?? '')
  const targetId = String(formData.get('target_event_id') ?? '')

  if (!sourceId || !targetId || sourceId === targetId) {
    redirectWith('error', '統合元と統合先には異なるイベントを選んでください。')
  }

  const supabase = createAdminClient()

  const { data: source } = await supabase
    .from('event')
    .select(
      'name, name_ja, founded_year, country, prefecture, description, genre_id, image_url, official_site_url, official_youtube_url'
    )
    .eq('id', sourceId)
    .single()
  const { data: target } = await supabase
    .from('event')
    .select(
      'id, name, name_ja, founded_year, country, prefecture, description, genre_id, image_url, official_site_url, official_youtube_url'
    )
    .eq('id', targetId)
    .single()

  if (!source || !target) {
    redirectWith('error', '指定のイベントが見つかりませんでした。')
  }

  // メタデータ補完(統合先が未設定の項目のみ、統合元の値で埋める)
  const metaFill: Record<string, string | number> = {}
  if (!target!.name_ja && source!.name_ja) metaFill.name_ja = source!.name_ja
  if (!target!.founded_year && source!.founded_year) metaFill.founded_year = source!.founded_year
  if (!target!.country && source!.country) metaFill.country = source!.country
  if (!target!.prefecture && source!.prefecture) metaFill.prefecture = source!.prefecture
  if (!target!.description && source!.description) metaFill.description = source!.description
  if (!target!.genre_id && source!.genre_id) metaFill.genre_id = source!.genre_id
  if (!target!.image_url && source!.image_url) metaFill.image_url = source!.image_url
  if (!target!.official_site_url && source!.official_site_url) metaFill.official_site_url = source!.official_site_url
  if (!target!.official_youtube_url && source!.official_youtube_url) {
    metaFill.official_youtube_url = source!.official_youtube_url
  }
  if (Object.keys(metaFill).length > 0) {
    await supabase.from('event').update(metaFill).eq('id', targetId)
  }

  // event_genre: (genre_id, target)が既にあれば重複させず削除、無ければ付け替え
  const { data: sourceGenres } = await supabase.from('event_genre').select('id, genre_id').eq('event_id', sourceId)
  const { data: targetGenres } = await supabase.from('event_genre').select('genre_id').eq('event_id', targetId)
  const targetGenreIds = new Set((targetGenres ?? []).map((r) => r.genre_id))
  for (const row of sourceGenres ?? []) {
    if (targetGenreIds.has(row.genre_id)) {
      await supabase.from('event_genre').delete().eq('id', row.id)
    } else {
      await supabase.from('event_genre').update({ event_id: targetId }).eq('id', row.id)
    }
  }

  // event_edition: (event_id, year)が既にtarget側にあれば、そのeditionへ
  // event_appearance/event_edition_date/setlistを付け替えてsource側のeditionを
  // 削除。無ければeditionごとtargetへ付け替える。
  const { data: sourceEditions } = await supabase
    .from('event_edition')
    .select('id, year, start_date, end_date, venue, description')
    .eq('event_id', sourceId)
  const { data: targetEditions } = await supabase
    .from('event_edition')
    .select('id, year, start_date, end_date, venue, description')
    .eq('event_id', targetId)
  const targetEditionByYear = new Map((targetEditions ?? []).map((e) => [e.year, e]))

  for (const sourceEdition of sourceEditions ?? []) {
    const matchingTarget = targetEditionByYear.get(sourceEdition.year)
    if (matchingTarget) {
      const editionFill: Record<string, string> = {}
      if (!matchingTarget.venue && sourceEdition.venue) editionFill.venue = sourceEdition.venue
      if (!matchingTarget.start_date && sourceEdition.start_date) editionFill.start_date = sourceEdition.start_date
      if (!matchingTarget.end_date && sourceEdition.end_date) editionFill.end_date = sourceEdition.end_date
      if (!matchingTarget.description && sourceEdition.description) editionFill.description = sourceEdition.description
      if (Object.keys(editionFill).length > 0) {
        await supabase.from('event_edition').update(editionFill).eq('id', matchingTarget.id)
      }

      await supabase
        .from('event_appearance')
        .update({ event_edition_id: matchingTarget.id })
        .eq('event_edition_id', sourceEdition.id)
      await supabase
        .from('event_edition_date')
        .update({ event_edition_id: matchingTarget.id })
        .eq('event_edition_id', sourceEdition.id)
      await supabase.from('setlist').update({ event_edition_id: matchingTarget.id }).eq('event_edition_id', sourceEdition.id)
      await supabase.from('event_edition').delete().eq('id', sourceEdition.id)
    } else {
      await supabase.from('event_edition').update({ event_id: targetId }).eq('id', sourceEdition.id)
    }
  }

  const { error: deleteError } = await supabase.from('event').delete().eq('id', sourceId)
  if (deleteError) {
    redirectWith('error', `統合元イベントの削除に失敗しました(付け替えは完了しています): ${deleteError.message}`)
  }

  revalidatePath('/admin/data/events')
  revalidatePath('/admin/data/events/festival-pilot')
  redirectWith('success', `「${source!.name}」を「${target!.name}」へ統合しました。`)
}

export type FestivalExtractResult =
  | {
      success: true
      imageUrl: string | null
      candidates: FestivalLineupCandidate[]
      festivalName: string
      editionYear: number
      startDate: string | null
      endDate: string | null
    }
  | { success: false; message: string }

/** フェスの公式サイトURLからキービジュアル(og:image)とラインナップ候補をAIで
 * 抽出する(自動登録はしない、確認画面用の候補を返すだけ)。 */
export async function extractFestivalLineupCandidates(
  eventId: string,
  eventEditionId: string
): Promise<FestivalExtractResult> {
  const supabase = createAdminClient()
  const [{ data: event }, { data: edition }] = await Promise.all([
    supabase.from('event').select('name, official_site_url').eq('id', eventId).single(),
    supabase.from('event_edition').select('year, start_date, end_date').eq('id', eventEditionId).single(),
  ])

  if (!event || !edition) {
    return { success: false, message: '対象が見つかりませんでした。' }
  }
  if (!event.official_site_url) {
    return { success: false, message: '公式サイトURLが未設定です。先に基本情報欄で登録してください。' }
  }

  let html: string
  try {
    html = await fetchFestivalPageHtml(event.official_site_url)
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : 'ページ取得に失敗しました。' }
  }

  const imageUrl = extractOgImage(html)
  const pageText = stripHtmlToText(html)

  let candidates: FestivalLineupCandidate[]
  try {
    candidates = await extractFestivalLineupWithGemini(pageText)
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? `AI抽出に失敗しました: ${err.message}` : 'AI抽出に失敗しました。',
    }
  }

  return {
    success: true,
    imageUrl,
    candidates,
    festivalName: event.name,
    editionYear: edition.year,
    startDate: edition.start_date,
    endDate: edition.end_date,
  }
}

/** AI抽出で見つかったog:imageを、確認のうえイベントのキービジュアルとして採用する。 */
export async function setEventImageFromUrl(eventId: string, imageUrl: string): Promise<{ success: boolean; message: string }> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('event').update({ image_url: imageUrl }).eq('id', eventId)
  if (error) {
    return { success: false, message: `画像の設定に失敗しました: ${error.message}` }
  }
  revalidatePath(`/admin/data/events/event/${eventId}/edit`)
  revalidatePath(`/events/${eventId}`)
  return { success: true, message: '画像を設定しました。' }
}

function redirectToEventEdit(eventId: string, result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/events/event/${eventId}/edit?${result}=${encodeURIComponent(message)}`)
}

/** フェス登録画面(会場)からの追加。追加後は同じフェスの編集画面に戻る。 */
export async function createEventVenue(formData: FormData) {
  const eventId = String(formData.get('event_id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const address = String(formData.get('address') ?? '').trim()

  if (!eventId || !name) {
    redirectToEventEdit(eventId, 'error', '会場名を入力してください。')
  }

  const supabase = createAdminClient()
  const { data: existing } = await supabase
    .from('event_venue')
    .select('sort_order')
    .eq('event_id', eventId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = (existing?.sort_order ?? -1) + 1

  const { error } = await supabase
    .from('event_venue')
    .insert({ event_id: eventId, name, address: address || null, sort_order: nextOrder })

  if (error) {
    redirectToEventEdit(eventId, 'error', `会場の登録に失敗しました: ${error.message}`)
  }

  revalidatePath(`/admin/data/events/event/${eventId}/edit`)
  redirectToEventEdit(eventId, 'success', '会場を登録しました。')
}

export async function updateEventVenue(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const eventId = String(formData.get('event_id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const address = String(formData.get('address') ?? '').trim()

  if (!id || !eventId || !name) {
    redirectToEventEdit(eventId, 'error', '会場名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('event_venue').update({ name, address: address || null }).eq('id', id)

  if (error) {
    redirectToEventEdit(eventId, 'error', `会場の更新に失敗しました: ${error.message}`)
  }

  revalidatePath(`/admin/data/events/event/${eventId}/edit`)
  redirectToEventEdit(eventId, 'success', '会場を更新しました。')
}

export async function deleteEventVenue(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const eventId = String(formData.get('event_id') ?? '')

  if (!id || !eventId) {
    redirectToEventEdit(eventId, 'error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('event_venue').delete().eq('id', id)

  if (error) {
    redirectToEventEdit(eventId, 'error', `会場の削除に失敗しました: ${error.message}`)
  }

  revalidatePath(`/admin/data/events/event/${eventId}/edit`)
  redirectToEventEdit(eventId, 'success', '会場を削除しました。')
}

/** フェス登録画面からの開催年追加。追加後は同じフェスの編集画面に戻る
 * (generic版のcreateEventEditionは一覧ページに戻ってしまうため別関数にしている)。 */
export async function createFestivalEdition(formData: FormData) {
  const eventId = String(formData.get('event_id') ?? '')
  const yearRaw = String(formData.get('year') ?? '').trim()
  const startDate = String(formData.get('start_date') ?? '').trim()
  const endDate = String(formData.get('end_date') ?? '').trim()
  const venue = String(formData.get('venue') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()

  if (!eventId || !yearRaw) {
    redirectToEventEdit(eventId, 'error', '年を入力してください。')
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
    redirectToEventEdit(eventId, 'error', `開催年の登録に失敗しました: ${error.message}`)
  }

  revalidatePath(`/admin/data/events/event/${eventId}/edit`)
  revalidatePath('/albums/calendar')
  redirectToEventEdit(eventId, 'success', '開催年を登録しました。')
}

export async function deleteFestivalEdition(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const eventId = String(formData.get('event_id') ?? '')

  if (!id || !eventId) {
    redirectToEventEdit(eventId, 'error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('event_edition').delete().eq('id', id)

  if (error) {
    redirectToEventEdit(eventId, 'error', `開催年の削除に失敗しました: ${error.message}`)
  }

  revalidatePath(`/admin/data/events/event/${eventId}/edit`)
  revalidatePath('/albums/calendar')
  redirectToEventEdit(eventId, 'success', '開催年を削除しました(紐づく出演情報も削除されました)。')
}

/** フェス登録画面からのタイムテーブル(出演情報)追加。追加後は同じフェスの
 * 編集画面に戻る(generic版のcreateEventAppearanceは一覧ページに戻ってしまうため別関数)。 */
export async function createFestivalAppearance(formData: FormData) {
  const eventId = String(formData.get('event_id') ?? '')
  const eventEditionId = String(formData.get('event_edition_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')
  const stage = String(formData.get('stage') ?? '').trim()
  const venue = String(formData.get('venue') ?? '').trim()
  const startTime = String(formData.get('start_time') ?? '').trim()
  const endTime = String(formData.get('end_time') ?? '').trim()
  const isHeadliner = formData.get('is_headliner') === 'on'

  if (!eventId || !eventEditionId || !artistId) {
    redirectToEventEdit(eventId, 'error', '開催年とアーティストを選択してください。')
  }

  const supabase = createAdminClient()
  const { data: inserted, error } = await supabase
    .from('event_appearance')
    .insert({
      event_edition_id: eventEditionId,
      artist_id: artistId,
      stage: stage || null,
      venue: venue || null,
      start_time: startTime ? `${startTime}:00+09:00` : null,
      end_time: endTime ? `${endTime}:00+09:00` : null,
      is_headliner: isHeadliner,
    })
    .select('id')
    .single()

  if (error || !inserted) {
    redirectToEventEdit(eventId, 'error', `出演情報の登録に失敗しました: ${error?.message}`)
  }

  const { error: linkError } = await supabase
    .from('event_appearance_artist')
    .insert({ event_appearance_id: inserted!.id, artist_id: artistId, billing_order: 0 })
  if (linkError) {
    redirectToEventEdit(eventId, 'error', `出演情報のアーティスト紐付けに失敗しました: ${linkError.message}`)
  }

  revalidatePath(`/admin/data/events/event/${eventId}/edit`)
  revalidatePath(`/artists/${artistId}`)
  redirectToEventEdit(eventId, 'success', '出演情報を登録しました。')
}

export async function deleteFestivalAppearance(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const eventId = String(formData.get('event_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')

  if (!id || !eventId) {
    redirectToEventEdit(eventId, 'error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('event_appearance').delete().eq('id', id)

  if (error) {
    redirectToEventEdit(eventId, 'error', `出演情報の削除に失敗しました: ${error.message}`)
  }

  revalidatePath(`/admin/data/events/event/${eventId}/edit`)
  if (artistId) revalidatePath(`/artists/${artistId}`)
  redirectToEventEdit(eventId, 'success', '出演情報を削除しました。')
}

export async function deleteMusicEvent(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')

  if (!id) {
    redirectWith('error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('music_event').delete().eq('id', id)

  if (error) {
    redirectWith('error', `削除に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/events')
  if (artistId) revalidatePath(`/artists/${artistId}`)
  redirectWith('success', '単独公演を削除しました。')
}
