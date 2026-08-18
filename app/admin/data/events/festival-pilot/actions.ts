'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchArtist, fetchArtistWithAlbums, type ItunesArtistSearchResult } from '@/utils/itunes'
import { upsertArtistFromItunes } from '@/app/admin/import/actions'
import { dispatchAlbumSync } from '@/utils/albumSyncDispatch'

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
 * そのままフェスの出演情報としても登録する。
 *
 * アルバム数が多いアーティストだとアルバム・トラックの取込に数十秒〜1分以上
 * かかることがあり、Vercelのサーバー関数の実行時間上限を超えて処理が
 * 中断される恐れがある。そのため「アーティスト本体の登録 + 出演情報登録」
 * だけを先に完了させてすぐ結果を返し、アルバム・トラックの取込は
 * after()でレスポンス後にバックグラウンド実行する(失敗しても出演情報の
 * 登録自体には影響しない) */
export async function importAndRegisterFestivalArtist(
  input: ImportAndRegisterInput
): Promise<ImportAndRegisterResult> {
  const supabase = createAdminClient()

  const { artist: itunesArtist, albums: itunesAlbums } = await fetchArtistWithAlbums(
    String(input.appleMusicArtistId)
  )
  if (!itunesArtist) {
    return { success: false, message: '指定のアーティストがApple Musicに見つかりませんでした。' }
  }

  const { artistId, errorMessage: artistError } = await upsertArtistFromItunes(supabase, itunesArtist)
  if (!artistId) {
    return { success: false, message: `アーティストの登録に失敗しました: ${artistError}` }
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
    .eq('artist_id', artistId)
    .maybeSingle()

  if (!existingAppearance) {
    const { error: appearanceError } = await supabase.from('event_appearance').insert({
      event_edition_id: editionId,
      artist_id: artistId,
      stage: input.stage || null,
      start_time: input.startAt || (input.performanceDate ? `${input.performanceDate}T12:00:00+00:00` : null),
      end_time: input.endAt || null,
      is_headliner: false,
    })
    if (appearanceError) {
      return { success: false, message: `出演情報の登録に失敗しました: ${appearanceError.message}` }
    }
  }

  // ここまでで出演登録は完了。アルバム・トラックの取込はレスポンス後に続行する
  // (チャンク分割・MusicBrainz取込の連鎖はutils/albumSyncDispatch.ts参照)
  after(() => dispatchAlbumSync(artistId, itunesArtist.artistName, String(itunesArtist.artistId), itunesAlbums))

  revalidatePath('/admin/data/events/festival-pilot')
  revalidatePath('/admin/data/events')
  revalidatePath(`/artists/${artistId}`)
  return {
    success: true,
    message: `「${itunesArtist.artistName}」を登録しました(アルバム${itunesAlbums.length}件は裏で取込中です)。`,
  }
}
