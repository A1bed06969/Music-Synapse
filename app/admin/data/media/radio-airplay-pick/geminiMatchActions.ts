'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchTracks, searchAlbums } from '@/utils/itunes'
import { judgeRadioPickMatchWithGemini, type RadioPickCandidate, type RadioPickContext } from '@/utils/geminiRadioPickMatch'
import { isAlbumCampaign } from '@/utils/radioStationPeriod'
import { safeRevalidatePath } from '@/utils/safeRevalidate'
import { registerPickIdToRotation } from './actions'

const AUTO_APPLY_THRESHOLD = 0.9
const REVIEW_THRESHOLD = 0.5
const CANDIDATE_LIMIT = 5

type PickRow = {
  id: string
  station_name: string
  campaign_name: string | null
  picked_date: string
  artist_name: string
  track_title: string
  is_domestic: boolean | null
}

async function fetchCandidates(pick: PickRow): Promise<RadioPickCandidate[]> {
  const query = `${pick.artist_name} ${pick.track_title}`
  if (isAlbumCampaign(pick.campaign_name)) {
    const results = await searchAlbums(query, CANDIDATE_LIMIT)
    return results.map((r, index) => ({
      index,
      collectionId: r.collectionId,
      collectionName: r.collectionName,
      artistName: r.artistName,
      artworkUrl: r.artworkUrl100,
    }))
  }
  const results = await searchTracks(query, CANDIDATE_LIMIT)
  return results.map((r, index) => ({
    index,
    trackId: r.trackId,
    collectionId: r.collectionId,
    trackName: r.trackName,
    collectionName: r.collectionName,
    artistName: r.artistName,
    artworkUrl: r.artworkUrl100,
  }))
}

function toContext(pick: PickRow): RadioPickContext {
  return {
    stationName: pick.station_name,
    campaignName: pick.campaign_name,
    isDomestic: pick.is_domestic,
    pickedDate: pick.picked_date,
  }
}

/** 選んだ候補をradio_airplay_pick.candidate_*へ保存する。既存のsetPickCandidateFromSearch/
 * setAlbumCandidateFromSearchと同じ形(トラック単位/アルバム単位で保存するフィールドが異なる)。 */
async function applyCandidate(supabase: ReturnType<typeof createAdminClient>, pickId: string, chosen: RadioPickCandidate) {
  return supabase
    .from('radio_airplay_pick')
    .update({
      candidate_track_id: chosen.trackId ?? null,
      candidate_track_name: chosen.trackName ?? null,
      candidate_artist_name: chosen.artistName,
      candidate_collection_id: chosen.collectionId,
      candidate_collection_name: chosen.collectionName,
      candidate_artwork_url: chosen.artworkUrl ?? null,
    })
    .eq('id', pickId)
}

export type GeminiRadioPickResult = {
  status: 'auto_applied' | 'needs_review' | 'no_match' | 'error'
  message: string
  confidence?: number
}

/** 未マッチの1件について、Apple Music候補を検索しGeminiに判定させる。
 * 確信度90%以上ならcandidate_*フィールドへ即座に反映する(=マッチ済みへ移動。
 * 既存の手動フローと同じく、カタログへの本登録はここでは行わない)。
 * 50〜89%はログにだけ残し、管理画面の要確認キューに並べる。 */
export async function runGeminiMatchForOnePick(pickId: string): Promise<GeminiRadioPickResult> {
  const supabase = createAdminClient()

  const { data: pick } = await supabase
    .from('radio_airplay_pick')
    .select('id, station_name, campaign_name, picked_date, artist_name, track_title, is_domestic')
    .eq('id', pickId)
    .maybeSingle()
  if (!pick || !pick.artist_name || !pick.track_title) return { status: 'error', message: '対象が見つかりません。' }

  let candidates: RadioPickCandidate[]
  try {
    candidates = await fetchCandidates(pick as PickRow)
  } catch (err) {
    return { status: 'error', message: `Apple Music検索に失敗しました: ${(err as Error).message}` }
  }
  if (candidates.length === 0) return { status: 'no_match', message: '候補が見つかりませんでした。' }

  let judgement
  try {
    judgement = await judgeRadioPickMatchWithGemini(pick.artist_name, pick.track_title, candidates, toContext(pick as PickRow))
  } catch (err) {
    return { status: 'error', message: `Gemini判定に失敗しました: ${(err as Error).message}` }
  }

  const chosen = judgement.candidateIndex !== null ? candidates[judgement.candidateIndex] : null
  const autoApply = judgement.candidateIndex !== null && judgement.confidence >= AUTO_APPLY_THRESHOLD

  await supabase.from('radio_pick_match_log').insert({
    pick_id: pickId,
    action: 'set_candidate',
    stub_artist_name: pick.artist_name,
    stub_track_title: pick.track_title,
    station_name: pick.station_name,
    campaign_name: pick.campaign_name,
    chosen_track_id: chosen?.trackId ?? null,
    chosen_collection_id: chosen?.collectionId ?? null,
    chosen_label: chosen ? (chosen.trackName ?? chosen.collectionName) : null,
    chosen_artist_name: chosen?.artistName ?? null,
    confidence: judgement.confidence,
    reasoning: judgement.reasoning,
    candidates_json: candidates,
    auto_applied: autoApply,
  })

  if (autoApply && chosen) {
    const { error } = await applyCandidate(supabase, pickId, chosen)
    if (error) return { status: 'error', message: `自動反映に失敗しました: ${error.message}` }
    // 動作確認用スクリプトから直接importして呼んでも例外にならないようsafeRevalidatePathを使う
    safeRevalidatePath('/admin/data/media/radio-airplay-pick')
    return { status: 'auto_applied', message: '自動反映しました。', confidence: judgement.confidence }
  }

  if (judgement.candidateIndex !== null) {
    return { status: 'needs_review', message: judgement.reasoning, confidence: judgement.confidence }
  }
  return { status: 'no_match', message: judgement.reasoning, confidence: judgement.confidence }
}

export type GeminiRadioPickBulkResult = {
  processed: number
  autoApplied: number
  needsReview: number
  noMatch: number
  errors: number
}

/** 未マッチ全件(candidate_track_id・candidate_collection_idどちらも未設定)に対して
 * Gemini判定を一括実行する。/admin/data/media/radio-airplay-pickの
 * 「Geminiで一括マッチング」ボタンから呼ぶ。件数がそれほど多くない前提
 * (2026-09時点で175件程度)で、まとめて画面から実行できる規模に収まる。 */
export async function runGeminiMatchForAllUnmatched(): Promise<GeminiRadioPickBulkResult> {
  const supabase = createAdminClient()

  const { data: picks } = await supabase
    .from('radio_airplay_pick')
    .select('id')
    .is('candidate_track_id', null)
    .is('candidate_collection_id', null)
    .not('artist_name', 'is', null)
    .not('track_title', 'is', null)

  const result: GeminiRadioPickBulkResult = { processed: 0, autoApplied: 0, needsReview: 0, noMatch: 0, errors: 0 }

  for (const row of picks ?? []) {
    result.processed += 1
    const r = await runGeminiMatchForOnePick(row.id)
    if (r.status === 'auto_applied') result.autoApplied += 1
    else if (r.status === 'needs_review') result.needsReview += 1
    else if (r.status === 'no_match') result.noMatch += 1
    else result.errors += 1
  }

  revalidatePath('/admin/data/media/radio-airplay-pick')
  return result
}

export type GeminiRadioPickVerifyResult = {
  status: 'registered' | 'cleared' | 'needs_review' | 'error'
  message: string
  confidence?: number
}

/** マッチ済み・未登録の1件について、既に付いている候補を文脈込みで再判定する。
 * scripts/backfill-radio-pick-itunes-candidates.tsが付けた「artist+title検索の
 * 上位1件」という単純な候補が本当に合っているかを確認する目的。
 * 確信度90%以上で確認できればそのままregisterPickIdToRotationで本登録、
 * 50%未満で明確に違うと判定されれば候補をクリアして未マッチへ差し戻す
 * (=見つけ直しの対象に戻す)。中間はログにだけ残し、現状(マッチ済み・未登録)を維持する。 */
export async function runGeminiVerifyForOneMatch(pickId: string): Promise<GeminiRadioPickVerifyResult> {
  const supabase = createAdminClient()

  const { data: pick } = await supabase
    .from('radio_airplay_pick')
    .select(
      'id, station_name, campaign_name, picked_date, artist_name, track_title, is_domestic, candidate_track_id, candidate_track_name, candidate_collection_id, candidate_collection_name, candidate_artist_name, candidate_artwork_url, registered_rotation_id'
    )
    .eq('id', pickId)
    .maybeSingle()

  if (!pick || !pick.candidate_collection_id || pick.registered_rotation_id || !pick.artist_name || !pick.track_title) {
    return { status: 'error', message: '対象が見つからないか、既に登録済みです。' }
  }

  const existingCandidate: RadioPickCandidate = {
    index: 0,
    trackId: pick.candidate_track_id ?? undefined,
    collectionId: pick.candidate_collection_id,
    trackName: pick.candidate_track_name ?? undefined,
    collectionName: pick.candidate_collection_name ?? '',
    artistName: pick.candidate_artist_name ?? '',
    artworkUrl: pick.candidate_artwork_url ?? undefined,
  }

  let judgement
  try {
    judgement = await judgeRadioPickMatchWithGemini(pick.artist_name, pick.track_title, [existingCandidate], toContext(pick as PickRow))
  } catch (err) {
    return { status: 'error', message: `Gemini判定に失敗しました: ${(err as Error).message}` }
  }

  const verified = judgement.candidateIndex === 0

  let status: GeminiRadioPickVerifyResult['status']
  let message: string
  let autoApplied = false

  if (verified && judgement.confidence >= AUTO_APPLY_THRESHOLD) {
    const registerResult = await registerPickIdToRotation(pickId)
    if (!registerResult.success) return { status: 'error', message: registerResult.message, confidence: judgement.confidence }
    status = 'registered'
    message = registerResult.message
    autoApplied = true
  } else if (!verified || judgement.confidence < REVIEW_THRESHOLD) {
    await supabase
      .from('radio_airplay_pick')
      .update({
        candidate_track_id: null,
        candidate_track_name: null,
        candidate_artist_name: null,
        candidate_collection_id: null,
        candidate_collection_name: null,
        candidate_artwork_url: null,
      })
      .eq('id', pickId)
    status = 'cleared'
    message = judgement.reasoning
    autoApplied = true
  } else {
    status = 'needs_review'
    message = judgement.reasoning
    autoApplied = false
  }

  await supabase.from('radio_pick_match_log').insert({
    pick_id: pickId,
    action: 'verify_register',
    stub_artist_name: pick.artist_name,
    stub_track_title: pick.track_title,
    station_name: pick.station_name,
    campaign_name: pick.campaign_name,
    chosen_track_id: existingCandidate.trackId ?? null,
    chosen_collection_id: existingCandidate.collectionId,
    chosen_label: existingCandidate.trackName ?? existingCandidate.collectionName,
    chosen_artist_name: existingCandidate.artistName,
    confidence: judgement.confidence,
    reasoning: judgement.reasoning,
    candidates_json: [existingCandidate],
    auto_applied: autoApplied,
  })

  // scripts/verify-radio-pick-matches.tsから直接importして呼ばれるため、
  // リクエストコンテキスト外でも例外にならないsafeRevalidatePathを使う
  safeRevalidatePath('/admin/data/media/radio-airplay-pick')
  return { status, message, confidence: judgement.confidence }
}

type ActionResult = { success: boolean; message: string }

/** 確信度50〜89%の「候補設定」判定を、管理者がその場で確定する。 */
export async function confirmRadioPickMatchLog(logId: string): Promise<ActionResult> {
  const supabase = createAdminClient()

  const { data: log } = await supabase
    .from('radio_pick_match_log')
    .select('id, pick_id, action, chosen_track_id, chosen_collection_id, chosen_label, chosen_artist_name, candidates_json, auto_applied, reverted')
    .eq('id', logId)
    .maybeSingle()
  if (!log) return { success: false, message: 'ログが見つかりません。' }
  if (log.action !== 'set_candidate') return { success: false, message: 'このログは確定操作の対象ではありません。' }
  if (log.auto_applied) return { success: false, message: '既に自動反映済みです。' }
  if (log.reverted) return { success: false, message: '取消済みの判定です。' }
  if (!log.chosen_collection_id) return { success: false, message: '候補が選ばれていない判定です。' }

  const candidates = (log.candidates_json as RadioPickCandidate[] | null) ?? []
  const chosen = candidates.find((c) => c.collectionId === log.chosen_collection_id && (c.trackId ?? null) === (log.chosen_track_id ?? null)) ?? {
    index: 0,
    trackId: log.chosen_track_id ?? undefined,
    collectionId: log.chosen_collection_id,
    trackName: log.chosen_track_id ? (log.chosen_label ?? undefined) : undefined,
    collectionName: log.chosen_track_id ? '' : (log.chosen_label ?? ''),
    artistName: log.chosen_artist_name ?? '',
  }

  const { error } = await applyCandidate(supabase, log.pick_id, chosen)
  if (error) return { success: false, message: `反映に失敗しました: ${error.message}` }

  await supabase.from('radio_pick_match_log').update({ auto_applied: true }).eq('id', logId)
  revalidatePath('/admin/data/media/radio-airplay-pick')
  return { success: true, message: '候補を反映しました。' }
}

/** 自動反映(set_candidate)・自動確定(verify_registerのcleared)を取り消す。
 * set_candidate: 候補をクリアして未マッチに戻す。
 * verify_registerでcleared(候補クリア)された判定: 候補を元に戻す
 * (Geminiが誤って「別物」と判定したケースの救済)。本登録済み(registered)は
 * 対象外(既存の「本登録を解除」ボタンで扱う)。 */
export async function revertRadioPickMatchLog(logId: string): Promise<ActionResult> {
  const supabase = createAdminClient()

  const { data: log } = await supabase
    .from('radio_pick_match_log')
    .select(
      'id, pick_id, action, chosen_track_id, chosen_collection_id, chosen_label, chosen_artist_name, candidates_json, auto_applied, reverted'
    )
    .eq('id', logId)
    .maybeSingle()
  if (!log) return { success: false, message: 'ログが見つかりません。' }
  if (!log.auto_applied) return { success: false, message: '自動反映されていない判定です。' }
  if (log.reverted) return { success: false, message: '既に取消済みです。' }
  if (!log.chosen_collection_id) return { success: false, message: '取消対象の候補情報がありません(本登録済みの可能性があります)。' }

  // verify_registerでconfidence>=0.9(本登録まで行った)場合は、この関数の
  // 「候補を元に戻す」処理では不十分(radio_rotation行の削除・registered_rotation_idの
  // クリアが伴わない)。本登録済みかどうかはpick.registered_rotation_idで判定し、
  // 該当する場合は既存の「本登録を解除」ボタン(unregisterPickFromRotation)を使うよう案内する。
  const { data: pick } = await supabase.from('radio_airplay_pick').select('registered_rotation_id').eq('id', log.pick_id).maybeSingle()
  if (pick?.registered_rotation_id) {
    return { success: false, message: '本登録済みです。一覧の「本登録を解除」から取り消してください。' }
  }

  const candidates = (log.candidates_json as RadioPickCandidate[] | null) ?? []
  const chosen = candidates.find((c) => c.collectionId === log.chosen_collection_id && (c.trackId ?? null) === (log.chosen_track_id ?? null)) ?? {
    index: 0,
    trackId: log.chosen_track_id ?? undefined,
    collectionId: log.chosen_collection_id,
    trackName: log.chosen_track_id ? (log.chosen_label ?? undefined) : undefined,
    collectionName: log.chosen_track_id ? '' : (log.chosen_label ?? ''),
    artistName: log.chosen_artist_name ?? '',
  }

  const { error } = await applyCandidate(supabase, log.pick_id, chosen)
  if (error) return { success: false, message: `取消に失敗しました: ${error.message}` }

  await supabase.from('radio_pick_match_log').update({ reverted: true, reverted_at: new Date().toISOString() }).eq('id', logId)
  revalidatePath('/admin/data/media/radio-airplay-pick')
  return { success: true, message: '候補を元に戻しました。' }
}
