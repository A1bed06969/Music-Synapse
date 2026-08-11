'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'

function redirectWith(result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/media/radio-pilot?${result}=${encodeURIComponent(message)}`)
}

export async function registerRadioPick(formData: FormData) {
  const stationName = String(formData.get('station_name') ?? '').trim()
  const programName = String(formData.get('program_name') ?? '').trim()
  const periodStartDate = String(formData.get('period_start_date') ?? '').trim()
  const artistId = String(formData.get('artist_id') ?? '').trim()
  const trackId = String(formData.get('track_id') ?? '').trim()
  const musicType = String(formData.get('music_type') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim()

  if (!stationName || !programName || !periodStartDate || !artistId || !musicType) {
    redirectWith('error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()

  const { data: existingMedia } = await supabase.from('media').select('id').eq('name', stationName).maybeSingle()
  let mediaId = existingMedia?.id as string | undefined
  if (!mediaId) {
    const { data: createdMedia, error } = await supabase
      .from('media')
      .insert({ name: stationName, media_type: 'radio' })
      .select('id')
      .single()
    if (error || !createdMedia) {
      redirectWith('error', `局の登録に失敗しました: ${error?.message}`)
    }
    mediaId = createdMedia!.id
  }

  const { data: existingProgram } = await supabase
    .from('media_program')
    .select('id')
    .eq('media_id', mediaId!)
    .eq('program_name', programName)
    .maybeSingle()
  let programId = existingProgram?.id as string | undefined
  if (!programId) {
    const { data: createdProgram, error } = await supabase
      .from('media_program')
      .insert({ media_id: mediaId, program_name: programName, period_type: 'monthly' })
      .select('id')
      .single()
    if (error || !createdProgram) {
      redirectWith('error', `番組の登録に失敗しました: ${error?.message}`)
    }
    programId = createdProgram!.id
  }

  const { error: rotationError } = await supabase.from('radio_rotation').insert({
    media_program_id: programId,
    period_type: 'monthly',
    period_start_date: periodStartDate,
    music_type: musicType,
    artist_id: artistId,
    track_id: trackId || null,
    note: note || null,
  })

  if (rotationError) {
    redirectWith('error', `登録に失敗しました: ${rotationError.message}`)
  }

  revalidatePath('/admin/data/media/radio-pilot')
  revalidatePath('/tracks')
  redirectWith('success', `「${stationName} ${programName}」を登録しました。`)
}
