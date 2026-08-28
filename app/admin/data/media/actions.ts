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

export async function updateMedia(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const mediaType = String(formData.get('media_type') ?? '').trim()
  const area = String(formData.get('area') ?? '').trim()
  const prefecture = String(formData.get('prefecture') ?? '').trim()
  const logoUrl = String(formData.get('logo_url') ?? '').trim()
  const validPrefecture = PREFECTURE_COORDS.some((p) => p.name === prefecture) ? prefecture : null

  if (!id || !name) {
    redirectWith('error', 'メディア名を入力してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('media')
    .update({
      name,
      media_type: mediaType || null,
      area: area || null,
      prefecture: validPrefecture,
      logo_url: logoUrl || null,
    })
    .eq('id', id)

  if (error) {
    redirectWith('error', `メディアの更新に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/media')
  revalidatePath('/media/on-air')
  redirectWith('success', `メディア「${name}」を更新しました。`)
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
  // 同じ曲がシングル/EP版とアルバム収録版など複数のtrack行に分かれている
  // ことがあるため、track_idは複数選択できる(1回の送信で両方に登録できる)
  const trackIds = formData.getAll('track_id').map(String).filter(Boolean)
  const albumId = String(formData.get('album_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')
  const note = String(formData.get('note') ?? '').trim()

  if (!mediaProgramId || !periodType || !periodStartDate || !musicType) {
    redirectWith('error', '番組・集計周期・対象期間・邦楽/洋楽を入力してください。')
  }

  const targetCount = [trackIds.length > 0, Boolean(albumId), Boolean(artistId)].filter(Boolean).length
  if (targetCount !== 1) {
    redirectWith('error', 'プッシュ対象は「トラック」「アルバム」「アーティスト」のうちどれか1つだけ選んでください。')
  }

  type RadioRotationRow = {
    media_program_id: string
    period_type: string
    period_start_date: string
    music_type: string
    track_id: string | null
    album_id: string | null
    artist_id: string | null
    note: string | null
  }

  const rows: RadioRotationRow[] =
    trackIds.length > 0
      ? trackIds.map((trackId) => ({
          media_program_id: mediaProgramId,
          period_type: periodType,
          period_start_date: periodStartDate,
          music_type: musicType,
          track_id: trackId,
          album_id: null,
          artist_id: null,
          note: note || null,
        }))
      : [
          {
            media_program_id: mediaProgramId,
            period_type: periodType,
            period_start_date: periodStartDate,
            music_type: musicType,
            track_id: null,
            album_id: albumId || null,
            artist_id: artistId || null,
            note: note || null,
          },
        ]

  const supabase = createAdminClient()
  const { error } = await supabase.from('radio_rotation').insert(rows)

  if (error) {
    redirectWith('error', `オンエアデータの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/media')
  revalidatePath('/media/on-air')
  for (const trackId of trackIds) {
    revalidatePath(`/tracks/${trackId}`)
  }
  redirectWith('success', `オンエアデータを登録しました(${rows.length}件)。`)
}

export async function updateRadioRotation(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const mediaProgramId = String(formData.get('media_program_id') ?? '')
  const periodType = String(formData.get('period_type') ?? '')
  const periodStartDate = String(formData.get('period_start_date') ?? '')
  const musicType = String(formData.get('music_type') ?? '')
  const trackId = String(formData.get('track_id') ?? '')
  const albumId = String(formData.get('album_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  const previousTrackId = String(formData.get('previous_track_id') ?? '')

  if (!id || !mediaProgramId || !periodType || !periodStartDate || !musicType) {
    redirectWith('error', '番組・集計周期・対象期間・邦楽/洋楽を入力してください。')
  }

  const targetCount = [Boolean(trackId), Boolean(albumId), Boolean(artistId)].filter(Boolean).length
  if (targetCount !== 1) {
    redirectWith('error', 'プッシュ対象は「トラック」「アルバム」「アーティスト」のうちどれか1つだけ選んでください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('radio_rotation')
    .update({
      media_program_id: mediaProgramId,
      period_type: periodType,
      period_start_date: periodStartDate,
      music_type: musicType,
      track_id: trackId || null,
      album_id: albumId || null,
      artist_id: artistId || null,
      note: note || null,
    })
    .eq('id', id)

  if (error) {
    redirectWith('error', `更新に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/media')
  revalidatePath('/media/on-air')
  if (trackId) revalidatePath(`/tracks/${trackId}`)
  if (previousTrackId && previousTrackId !== trackId) revalidatePath(`/tracks/${previousTrackId}`)
  redirectWith('success', 'オンエアデータを更新しました。')
}

export async function deleteRadioRotation(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const trackId = String(formData.get('track_id') ?? '')

  if (!id) {
    redirectWith('error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('radio_rotation').delete().eq('id', id)

  if (error) {
    redirectWith('error', `削除に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/media')
  revalidatePath('/media/on-air')
  if (trackId) revalidatePath(`/tracks/${trackId}`)
  redirectWith('success', 'オンエアデータを削除しました。')
}
