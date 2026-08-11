'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'
import { PREFECTURE_COORDS } from '@/utils/prefectures'

function redirectWith(result: 'success' | 'error', message: string) {
  redirect(`/admin/data/media?${result}=${encodeURIComponent(message)}`)
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

  revalidatePath('/admin/data/media')
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

  revalidatePath('/admin/data/media')
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

  revalidatePath('/admin/data/media')
  revalidatePath('/media/on-air')
  redirectWith('success', 'オンエアデータを登録しました。')
}
