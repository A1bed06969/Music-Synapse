'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchArtist, type ItunesArtistSearchResult } from '@/utils/itunes'
import { importArtistsFromItunes } from '@/app/admin/import/actions'

function redirectWith(result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/events/festival-pilot?${result}=${encodeURIComponent(message)}`)
}

type EditionInput = {
  festivalName: string
  editionYear: number
  startDate: string | null
  endDate: string | null
}

/** イベント(フェス本体)と開催回を無ければ作成し、開催回IDを返す */
async function findOrCreateFestivalEdition(
  supabase: SupabaseClient,
  input: EditionInput
): Promise<{ editionId: string | null; errorMessage: string | null }> {
  const { data: existingEvent } = await supabase
    .from('event')
    .select('id')
    .eq('name', input.festivalName)
    .maybeSingle()
  let eventId = existingEvent?.id as string | undefined
  if (!eventId) {
    const { data: createdEvent, error } = await supabase
      .from('event')
      .insert({
        name: input.festivalName,
        event_type: 'festival',
        country: 'イギリス',
        description: '毎年6月にワージー・ファーム(サマセット)で開催される世界最大級の野外音楽フェスティバル。',
      })
      .select('id')
      .single()
    if (error || !createdEvent) {
      return { editionId: null, errorMessage: `イベントの登録に失敗しました: ${error?.message}` }
    }
    eventId = createdEvent.id
  }

  const { data: existingEdition } = await supabase
    .from('event_edition')
    .select('id')
    .eq('event_id', eventId)
    .eq('year', input.editionYear)
    .maybeSingle()
  let editionId = existingEdition?.id as string | undefined
  if (!editionId) {
    const { data: createdEdition, error } = await supabase
      .from('event_edition')
      .insert({
        event_id: eventId,
        year: input.editionYear,
        start_date: input.startDate || null,
        end_date: input.endDate || null,
        venue: 'Worthy Farm, Pilton',
      })
      .select('id')
      .single()
    if (error || !createdEdition) {
      return { editionId: null, errorMessage: `開催回の登録に失敗しました: ${error?.message}` }
    }
    editionId = createdEdition.id
  }

  return { editionId: editionId ?? null, errorMessage: null }
}

export async function registerFestivalAppearance(formData: FormData) {
  const festivalName = String(formData.get('festival_name') ?? '').trim()
  const editionYearRaw = String(formData.get('edition_year') ?? '').trim()
  const startDate = String(formData.get('start_date') ?? '').trim()
  const endDate = String(formData.get('end_date') ?? '').trim()
  const artistId = String(formData.get('artist_id') ?? '').trim()
  const artistName = String(formData.get('artist_name') ?? '').trim()
  const stage = String(formData.get('stage') ?? '').trim()
  const performanceDate = String(formData.get('performance_date') ?? '').trim()
  const startAt = String(formData.get('start_at') ?? '').trim()
  const endAt = String(formData.get('end_at') ?? '').trim()

  if (!festivalName || !editionYearRaw || !artistId) {
    redirectWith('error', '不正なリクエストです。')
  }
  const editionYear = Number(editionYearRaw)

  const supabase = createAdminClient()

  const { editionId, errorMessage } = await findOrCreateFestivalEdition(supabase, {
    festivalName,
    editionYear,
    startDate: startDate || null,
    endDate: endDate || null,
  })
  if (!editionId) {
    redirectWith('error', errorMessage ?? '開催回の登録に失敗しました。')
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
    // 開演/終演時刻が取得できればそのまま使い、取得できない場合のみ
    // 出演日を日付グルーピング表示に使えるよう正午の仮時刻で保持する
    start_time: startAt || (performanceDate ? `${performanceDate}T12:00:00+00:00` : null),
    end_time: endAt || null,
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

/** カタログに無いアーティスト名でApple Musicを検索する(候補を人間が選ぶ前提、自動確定はしない) */
export async function searchAppleMusicArtist(name: string): Promise<ItunesArtistSearchResult[]> {
  return searchArtist(name)
}

export type ImportAndRegisterInput = {
  appleMusicArtistId: number
  festivalName: string
  editionYear: number
  startDate: string | null
  endDate: string | null
  stage: string | null
  performanceDate: string | null
  startAt: string | null
  endAt: string | null
}

export type ImportAndRegisterResult = { success: boolean; message: string }

/** 選ばれたApple Musicアーティストをカタログへ取込み(既存の一括登録処理を再利用)、
 * そのままフェスの出演情報としても登録する */
export async function importAndRegisterFestivalArtist(
  input: ImportAndRegisterInput
): Promise<ImportAndRegisterResult> {
  const supabase = createAdminClient()

  const [importResult] = await importArtistsFromItunes([String(input.appleMusicArtistId)])
  if (!importResult.success) {
    return { success: false, message: `Apple Music取込に失敗しました: ${importResult.message}` }
  }

  const { data: artistRow } = await supabase
    .from('artist')
    .select('id')
    .eq('apple_music_artist_id', String(input.appleMusicArtistId))
    .maybeSingle()
  if (!artistRow) {
    return { success: false, message: '取込には成功しましたが、登録済みアーティストの特定に失敗しました。' }
  }

  const { editionId, errorMessage } = await findOrCreateFestivalEdition(supabase, {
    festivalName: input.festivalName,
    editionYear: input.editionYear,
    startDate: input.startDate,
    endDate: input.endDate,
  })
  if (!editionId) {
    return { success: false, message: errorMessage ?? '開催回の登録に失敗しました。' }
  }

  const { data: existingAppearance } = await supabase
    .from('event_appearance')
    .select('id')
    .eq('event_edition_id', editionId)
    .eq('artist_id', artistRow.id)
    .maybeSingle()
  if (existingAppearance) {
    revalidatePath('/admin/data/events/festival-pilot')
    return { success: true, message: `「${importResult.artistName}」を取込みました(出演情報は既に登録済みでした)。` }
  }

  const { error: appearanceError } = await supabase.from('event_appearance').insert({
    event_edition_id: editionId,
    artist_id: artistRow.id,
    stage: input.stage || null,
    start_time: input.startAt || (input.performanceDate ? `${input.performanceDate}T12:00:00+00:00` : null),
    end_time: input.endAt || null,
    is_headliner: false,
  })
  if (appearanceError) {
    return { success: false, message: `出演情報の登録に失敗しました: ${appearanceError.message}` }
  }

  revalidatePath('/admin/data/events/festival-pilot')
  revalidatePath('/admin/data/events')
  revalidatePath(`/artists/${artistRow.id}`)
  return {
    success: true,
    message: `「${importResult.artistName}」を取込・登録しました(アルバム${importResult.albumCount}件・トラック${importResult.trackCount}件)。`,
  }
}
