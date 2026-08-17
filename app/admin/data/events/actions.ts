'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'

function redirectWith(result: 'success' | 'error', message: string) {
  redirect(`/admin/data/events?${result}=${encodeURIComponent(message)}`)
}

export async function createEvent(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const eventType = String(formData.get('event_type') ?? '').trim()
  const foundedYearRaw = String(formData.get('founded_year') ?? '').trim()
  const country = String(formData.get('country') ?? '').trim()
  const prefecture = String(formData.get('prefecture') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  const genreId = String(formData.get('genre_id') ?? '').trim()

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
    genre_id: genreId || null,
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

  if (!eventEditionId || !date || !venue) {
    redirectWith('error', '開催回・日付・会場を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('event_edition_date').insert({
    event_edition_id: eventEditionId,
    date,
    venue,
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
