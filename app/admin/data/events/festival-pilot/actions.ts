'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'

function redirectWith(result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/events/festival-pilot?${result}=${encodeURIComponent(message)}`)
}

export async function registerFestivalAppearance(formData: FormData) {
  const festivalName = String(formData.get('festival_name') ?? '').trim()
  const editionYearRaw = String(formData.get('edition_year') ?? '').trim()
  const startDate = String(formData.get('start_date') ?? '').trim()
  const endDate = String(formData.get('end_date') ?? '').trim()
  const artistId = String(formData.get('artist_id') ?? '').trim()
  const artistName = String(formData.get('artist_name') ?? '').trim()
  const stage = String(formData.get('stage') ?? '').trim()

  if (!festivalName || !editionYearRaw || !artistId) {
    redirectWith('error', '不正なリクエストです。')
  }
  const editionYear = Number(editionYearRaw)

  const supabase = createAdminClient()

  const { data: existingEvent } = await supabase.from('event').select('id').eq('name', festivalName).maybeSingle()
  let eventId = existingEvent?.id as string | undefined
  if (!eventId) {
    const { data: createdEvent, error } = await supabase
      .from('event')
      .insert({
        name: festivalName,
        event_type: 'festival',
        country: 'イギリス',
        description: '毎年6月にワージー・ファーム(サマセット)で開催される世界最大級の野外音楽フェスティバル。',
      })
      .select('id')
      .single()
    if (error || !createdEvent) {
      redirectWith('error', `イベントの登録に失敗しました: ${error?.message}`)
    }
    eventId = createdEvent!.id
  }

  const { data: existingEdition } = await supabase
    .from('event_edition')
    .select('id')
    .eq('event_id', eventId!)
    .eq('year', editionYear)
    .maybeSingle()
  let editionId = existingEdition?.id as string | undefined
  if (!editionId) {
    const { data: createdEdition, error } = await supabase
      .from('event_edition')
      .insert({
        event_id: eventId,
        year: editionYear,
        start_date: startDate || null,
        end_date: endDate || null,
        venue: 'Worthy Farm, Pilton',
      })
      .select('id')
      .single()
    if (error || !createdEdition) {
      redirectWith('error', `開催回の登録に失敗しました: ${error?.message}`)
    }
    editionId = createdEdition!.id
  }

  const { data: existingAppearance } = await supabase
    .from('event_appearance')
    .select('id')
    .eq('event_edition_id', editionId!)
    .eq('artist_id', artistId)
    .maybeSingle()
  if (existingAppearance) {
    redirectWith('error', `「${artistName}」は既に登録済みです。`)
  }

  const { error: appearanceError } = await supabase.from('event_appearance').insert({
    event_edition_id: editionId,
    artist_id: artistId,
    stage: stage || null,
    is_headliner: false,
  })

  if (appearanceError) {
    redirectWith('error', `出演情報の登録に失敗しました: ${appearanceError.message}`)
  }

  revalidatePath('/admin/data/events/festival-pilot')
  revalidatePath('/admin/data/events')
  revalidatePath(`/artists/${artistId}`)
  redirectWith('success', `「${artistName}」を${festivalName}(${editionYear})に登録しました。`)
}
