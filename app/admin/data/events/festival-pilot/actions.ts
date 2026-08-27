'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchArtist, fetchArtistWithAlbums, type ItunesArtistSearchResult } from '@/utils/itunes'
import { fetchAppleMusicArtistImage } from '@/utils/appleMusicImage'
import { upsertArtistFromItunes } from '@/app/admin/import/actions'
import { dispatchAlbumSync } from '@/utils/albumSyncDispatch'
import type { FestivalPick } from '@/utils/festivalScrape'

function redirectWith(result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/events/festival-pilot?${result}=${encodeURIComponent(message)}`)
}

function redirectDatasetsWith(result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/events/festival-pilot/datasets?${result}=${encodeURIComponent(message)}`)
}

/** SUMMER SONICのように同じ開催回に複数都市がある場合、出演情報自体にも
 * どちらの会場かを付ける(event_appearance.venue)。付けないとevents詳細ページの
 * 都市タブでの絞り込みが効かず、どちらのタブでも全都市の出演者が表示されてしまう
 * (実際に発生した不具合)。regionが無い(単一会場の)フェスではnullのままでよい。 */
async function resolveVenueForRegion(
  supabase: SupabaseClient,
  editionId: string,
  region: string | null | undefined
): Promise<string | null> {
  if (!region) return null
  const { data } = await supabase
    .from('event_edition_date')
    .select('venue')
    .eq('event_edition_id', editionId)
    .eq('region', region)
    .limit(1)
    .maybeSingle()
  return data?.venue ?? null
}

type FestivalPickWithFlag = FestivalPick & { suspicious?: boolean }

/** 貼り付けられたJSONが、最低限FestivalPick[]として使える形かを検証する
 * (完全な型検証ではなく、実行時に壊れる代表的な不備だけを弾く) */
function validateFestivalPicks(value: unknown): { picks: FestivalPickWithFlag[] | null; errorMessage: string | null } {
  if (!Array.isArray(value)) {
    return { picks: null, errorMessage: 'JSONは配列である必要があります。' }
  }
  if (value.length === 0) {
    return { picks: null, errorMessage: '空の配列です。' }
  }
  for (const [i, row] of value.entries()) {
    if (typeof row !== 'object' || row === null) {
      return { picks: null, errorMessage: `${i}件目が配列/オブジェクトの形になっていません。` }
    }
    const r = row as Record<string, unknown>
    if (typeof r.festivalName !== 'string' || !r.festivalName) {
      return { picks: null, errorMessage: `${i}件目にfestivalName(文字列)がありません。` }
    }
    if (typeof r.editionYear !== 'number') {
      return { picks: null, errorMessage: `${i}件目にeditionYear(数値)がありません。` }
    }
    if (typeof r.artistName !== 'string' || !r.artistName) {
      return { picks: null, errorMessage: `${i}件目にartistName(文字列)がありません。` }
    }
  }
  return { picks: value as FestivalPickWithFlag[], errorMessage: null }
}

/** festival-pilotの出演者候補データ(JSON配列)を、キー指定でDBに保存する(無ければ新規作成、
 * あれば更新)。コードへのコミット・デプロイ無しで新しいフェスを追加できるようにするため。 */
export async function saveFestivalPilotDataset(formData: FormData) {
  const key = String(formData.get('key') ?? '').trim()
  const label = String(formData.get('label') ?? '').trim()
  const picksRaw = String(formData.get('picks') ?? '').trim()

  if (!key || !label || !picksRaw) {
    redirectDatasetsWith('error', 'キー・表示名・JSONをすべて入力してください。')
  }
  if (!/^[a-z0-9_-]+$/.test(key)) {
    redirectDatasetsWith('error', 'キーは半角英小文字・数字・ハイフン・アンダースコアのみ使用できます。')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(picksRaw)
  } catch {
    redirectDatasetsWith('error', 'JSONの構文が不正です。')
  }

  const { picks, errorMessage } = validateFestivalPicks(parsed)
  if (!picks) {
    redirectDatasetsWith('error', errorMessage ?? 'JSONの形式が不正です。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('festival_pilot_dataset')
    .upsert({ key, label, picks }, { onConflict: 'key' })

  if (error) {
    redirectDatasetsWith('error', `保存に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/events/festival-pilot')
  revalidatePath('/admin/data/events/festival-pilot/datasets')
  redirectDatasetsWith('success', `「${label}」を保存しました(${picks!.length}件)。`)
}

export type QuickAddPilotResult = { success: true; key: string; message: string } | { success: false; message: string }

/** AI抽出(Gemini)がJS描画サイト等で0件だった場合の受け皿。空のpicks([])で
 * festival_pilot_datasetにエントリだけ作り、/festival-pilot/datasetsから後で
 * 手動でJSONを追記できるようにする(公式サイトのJSONデータエンドポイントを
 * 直接見つけて手動投入するケースが実際にあったため、その置き場を用意する)。
 * saveFestivalPilotDatasetと違い、空配列を意図的なプレースホルダーとして許可する。 */
export async function quickAddFestivalPilotDataset(eventId: string, eventName: string): Promise<QuickAddPilotResult> {
  const key = eventId.toLowerCase()
  const supabase = createAdminClient()

  const { data: existing } = await supabase.from('festival_pilot_dataset').select('key').eq('key', key).maybeSingle()
  if (existing) {
    return { success: true, key, message: `既に「${eventName}」はパイロット登録にあります。` }
  }

  const { error } = await supabase
    .from('festival_pilot_dataset')
    .upsert({ key, label: eventName, picks: [] }, { onConflict: 'key' })

  if (error) {
    return { success: false, message: `パイロット登録への追加に失敗しました: ${error.message}` }
  }

  revalidatePath('/admin/data/events/festival-pilot')
  revalidatePath('/admin/data/events/festival-pilot/datasets')
  return { success: true, key, message: `「${eventName}」をパイロット登録に追加しました。` }
}

export async function deleteFestivalPilotDataset(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  if (!id) {
    redirectDatasetsWith('error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('festival_pilot_dataset').delete().eq('id', id)

  if (error) {
    redirectDatasetsWith('error', `削除に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/events/festival-pilot')
  revalidatePath('/admin/data/events/festival-pilot/datasets')
  redirectDatasetsWith('success', '削除しました。')
}

type EditionInput = {
  festivalName: string
  editionYear: number
  startDate: string | null
  endDate: string | null
  // festival-pilotの各タブを識別するkey(festival_pilot_dataset.key、または
  // 静的スクレイピングの'glastonbury')。一度イベントを解決できたら
  // festival_pilot_event_linkにevent_idを固定し、以後は名前一致に頼らず
  // 直接そのevent_idを使う(下記コメント参照)。
  datasetKey?: string
}

/** イベント(フェス本体)と開催回を無ければ作成し、開催回IDを返す */
async function findOrCreateFestivalEdition(
  supabase: SupabaseClient,
  input: EditionInput
): Promise<{ editionId: string | null; errorMessage: string | null }> {
  // festival_pilot_event_linkに既にこのkeyのevent_idが記録されていれば、
  // 名前一致を一切試みずそれを最優先で使う。picks側のfestivalName表記が
  // event.nameと後からズレても(改名・統合等)、二度と別イベントとして
  // 重複作成されないようにするための固定リンク。
  let eventId: string | undefined
  if (input.datasetKey) {
    const { data: link } = await supabase
      .from('festival_pilot_event_link')
      .select('event_id')
      .eq('key', input.datasetKey)
      .maybeSingle()
    eventId = link?.event_id ?? undefined
  }

  if (!eventId) {
    // 完全一致(.eq)だと大文字小文字・前後の空白の違いだけで別イベントとして
    // 新規作成されてしまう(実際に発生した不具合: Coachella/Coachella Festival、
    // 風とロック芋煮会/風とロック芋煮会 in September JAM が別イベントになった)。
    // ilikeで大小文字を無視した完全一致にする(部分一致ではないので、名前が
    // 本当に違う別フェスを誤って同一視するリスクは無い)。2件以上ヒットする
    // 場合は既存の重複防止方針と同様にどれとも断定せず新規作成にフォールバックする。
    const { data: existingEvents } = await supabase
      .from('event')
      .select('id')
      .ilike('name', input.festivalName.trim())
      .limit(2)
    eventId = existingEvents?.length === 1 ? existingEvents[0].id : undefined
    if (!eventId) {
      // country/description等はフェスごとに異なるため、ここでは決め打ちせずnullのまま
      // 作成し(誤った国名で他フェスに登録されるのを防ぐ)、管理画面(/admin/data/events)から
      // 後で正しい値を入力する運用とする
      const { data: createdEvent, error } = await supabase
        .from('event')
        .insert({
          name: input.festivalName,
          event_type: 'festival',
        })
        .select('id')
        .single()
      if (error || !createdEvent) {
        return { editionId: null, errorMessage: `イベントの登録に失敗しました: ${error?.message}` }
      }
      eventId = createdEvent.id
    }

    if (input.datasetKey) {
      await supabase
        .from('festival_pilot_event_link')
        .upsert({ key: input.datasetKey, event_id: eventId }, { onConflict: 'key' })
    }
  }

  const { data: existingEdition } = await supabase
    .from('event_edition')
    .select('id')
    .eq('event_id', eventId)
    .eq('year', input.editionYear)
    .maybeSingle()
  let editionId = existingEdition?.id as string | undefined
  if (!editionId) {
    // venueもフェス・年ごとに異なるため決め打ちせずnullのまま作成する(上のevent同様)
    const { data: createdEdition, error } = await supabase
      .from('event_edition')
      .insert({
        event_id: eventId,
        year: input.editionYear,
        start_date: input.startDate || null,
        end_date: input.endDate || null,
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
  const datasetKey = String(formData.get('dataset_key') ?? '').trim() || undefined
  const region = String(formData.get('region') ?? '').trim() || null

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
    datasetKey,
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

  if (datasetKey) {
    await supabase
      .from('festival_pilot_artist_link')
      .upsert(
        { dataset_key: datasetKey, pick_name: artistName.trim().toUpperCase(), artist_id: artistId },
        { onConflict: 'dataset_key,pick_name' }
      )
  }

  const venue = await resolveVenueForRegion(supabase, editionId!, region)

  const { error: appearanceError } = await supabase.from('event_appearance').insert({
    event_edition_id: editionId,
    artist_id: artistId,
    stage: stage || null,
    venue,
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

export type ItunesArtistSearchResultWithImage = ItunesArtistSearchResult & { imageUrl: string | null }

/**
 * カタログに無いアーティスト名でApple Musicを検索する(候補を人間が選ぶ前提、自動確定はしない)。
 * 同名・類似名の別人が候補に並ぶことがあり、名前だけでは判別しづらいため、各候補の
 * 顔写真(og:imageスクレイピング。fetchAppleMusicArtistImageと同じ手法)も並行取得して返す。
 * 取得に失敗した候補はimageUrl: nullのまま返す(呼び出し側でプレースホルダー表示)
 */
export async function searchAppleMusicArtist(name: string): Promise<ItunesArtistSearchResultWithImage[]> {
  const candidates = await searchArtist(name)
  const withImages = await Promise.all(
    candidates.map(async (c) => ({
      ...c,
      imageUrl: await fetchAppleMusicArtistImage(String(c.artistId)).catch(() => null),
    }))
  )
  return withImages
}

export type ImportAndRegisterInput = {
  appleMusicArtistId: number
  // フェス側のスクレイピング/データセット表記そのもの(iTunes側の名前がローカライズ
  // されて一致しなくなった場合でも「この表記=このartist_id」を覚えておくためのキー)
  pickArtistName: string
  festivalName: string
  editionYear: number
  startDate: string | null
  endDate: string | null
  stage: string | null
  performanceDate: string | null
  startAt: string | null
  endAt: string | null
  datasetKey?: string
  region?: string | null
}

export type ImportAndRegisterResult =
  | { success: true; message: string; artistId: string; registeredName: string }
  | { success: false; message: string }

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
    datasetKey: input.datasetKey,
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
    const venue = await resolveVenueForRegion(supabase, editionId, input.region)
    const { error: appearanceError } = await supabase.from('event_appearance').insert({
      event_edition_id: editionId,
      artist_id: artistId,
      stage: input.stage || null,
      venue,
      start_time: input.startAt || (input.performanceDate ? `${input.performanceDate}T12:00:00+00:00` : null),
      end_time: input.endAt || null,
      is_headliner: false,
    })
    if (appearanceError) {
      return { success: false, message: `出演情報の登録に失敗しました: ${appearanceError.message}` }
    }
  }

  if (input.datasetKey) {
    await supabase
      .from('festival_pilot_artist_link')
      .upsert(
        { dataset_key: input.datasetKey, pick_name: input.pickArtistName.trim().toUpperCase(), artist_id: artistId },
        { onConflict: 'dataset_key,pick_name' }
      )
  }

  // ここまでで出演登録は完了。アルバム・トラックの取込はレスポンス後に続行する
  // (チャンク分割・MusicBrainz取込の連鎖はutils/albumSyncDispatch.ts参照)
  after(() => dispatchAlbumSync(artistId, itunesArtist.artistName, String(itunesArtist.artistId), itunesAlbums))

  revalidatePath('/admin/data/events/festival-pilot')
  revalidatePath('/admin/data/events')
  revalidatePath(`/artists/${artistId}`)
  return {
    success: true,
    artistId,
    registeredName: itunesArtist.artistName,
    message: `「${itunesArtist.artistName}」を登録しました(アルバム${itunesAlbums.length}件は裏で取込中です)。`,
  }
}

export type RegisterCollabAppearanceInput = {
  // フェス表記の合体名義そのもの(例:「THE SPELLBOUND × BOOM BOOM SATELLITES」)を
  // event_appearance.display_nameへそのまま保持する
  pickArtistName: string
  members: { appleMusicArtistId: number }[]
  festivalName: string
  editionYear: number
  startDate: string | null
  endDate: string | null
  stage: string | null
  performanceDate: string | null
  startAt: string | null
  endAt: string | null
  datasetKey?: string
  region?: string | null
}

/**
 * コラボ名義(例:「THE SPELLBOUND × BOOM BOOM SATELLITES」)でのフェス出演を登録する。
 * importAndRegisterFestivalArtistと違い、event_appearance.artist_idは先頭メンバーを
 * 代表として指すのみで、実際に出演した全メンバーはevent_appearance_artist経由で
 * 紐づける(両アーティストのページに出演情報が出るようにするため)。display_nameに
 * フェス表記の合体名義を保持するため、どのメンバーのページでも「この名義で出演」と
 * わかる。
 */
export async function registerCollabFestivalAppearance(
  input: RegisterCollabAppearanceInput
): Promise<ImportAndRegisterResult> {
  const supabase = createAdminClient()

  if (input.members.length < 2) {
    return { success: false, message: 'コラボ登録には2名以上のメンバーを選択してください。' }
  }

  const resolvedArtistIds: string[] = []
  const resolvedNames: string[] = []
  for (const member of input.members) {
    const { artist: itunesArtist, albums: itunesAlbums } = await fetchArtistWithAlbums(String(member.appleMusicArtistId))
    if (!itunesArtist) {
      return { success: false, message: 'メンバーの1人がApple Musicに見つかりませんでした。' }
    }
    const { artistId, errorMessage: artistError } = await upsertArtistFromItunes(supabase, itunesArtist)
    if (!artistId) {
      return { success: false, message: `メンバーの登録に失敗しました: ${artistError}` }
    }
    resolvedArtistIds.push(artistId)
    resolvedNames.push(itunesArtist.artistName)
    // アルバム・トラックの取込はメンバーごとにレスポンス後へ回す(importAndRegisterFestivalArtistと同じ理由)
    after(() => dispatchAlbumSync(artistId, itunesArtist.artistName, String(itunesArtist.artistId), itunesAlbums))
  }

  const { editionId, errorMessage } = await findOrCreateFestivalEdition(supabase, {
    festivalName: input.festivalName,
    editionYear: input.editionYear,
    startDate: input.startDate,
    endDate: input.endDate,
    datasetKey: input.datasetKey,
  })
  if (!editionId) {
    return { success: false, message: errorMessage ?? '開催回の登録に失敗しました。' }
  }

  const venue = await resolveVenueForRegion(supabase, editionId, input.region)
  const primaryArtistId = resolvedArtistIds[0]

  const { data: inserted, error: appearanceError } = await supabase
    .from('event_appearance')
    .insert({
      event_edition_id: editionId,
      artist_id: primaryArtistId,
      display_name: input.pickArtistName,
      stage: input.stage || null,
      venue,
      start_time: input.startAt || (input.performanceDate ? `${input.performanceDate}T12:00:00+00:00` : null),
      end_time: input.endAt || null,
      is_headliner: false,
    })
    .select('id')
    .single()
  if (appearanceError || !inserted) {
    return { success: false, message: `出演情報の登録に失敗しました: ${appearanceError?.message}` }
  }

  const { error: linkError } = await supabase.from('event_appearance_artist').insert(
    resolvedArtistIds.map((artistId, i) => ({
      event_appearance_id: inserted.id,
      artist_id: artistId,
      billing_order: i,
    }))
  )
  if (linkError) {
    return { success: false, message: `メンバーの紐付けに失敗しました: ${linkError.message}` }
  }

  if (input.datasetKey) {
    await supabase
      .from('festival_pilot_artist_link')
      .upsert(
        { dataset_key: input.datasetKey, pick_name: input.pickArtistName.trim().toUpperCase(), artist_id: primaryArtistId },
        { onConflict: 'dataset_key,pick_name' }
      )
  }

  revalidatePath('/admin/data/events/festival-pilot')
  revalidatePath('/admin/data/events')
  for (const artistId of resolvedArtistIds) revalidatePath(`/artists/${artistId}`)

  return {
    success: true,
    artistId: primaryArtistId,
    registeredName: input.pickArtistName,
    message: `「${input.pickArtistName}」(${resolvedNames.join(' × ')})を登録しました。`,
  }
}
