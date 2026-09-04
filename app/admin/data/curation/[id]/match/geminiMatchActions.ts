'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { matchAlbumsWithCandidates } from '@/utils/discGuideImport'
import { judgeAlbumMatchWithGemini, type AlbumMatchCandidate } from '@/utils/geminiAlbumMatch'
import { linkRankingEntryCandidate } from './actions'

const AUTO_APPLY_THRESHOLD = 0.9

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export type GeminiAlbumMatchResult = {
  status: 'auto_applied' | 'needs_review' | 'no_match' | 'error'
  message: string
  confidence?: number
}

/** 1件のスタブアルバム(ranking_entry経由)について、matchAlbumsWithCandidatesが
 * 返す候補をGeminiに判定させる。確信度が閾値以上なら即座にlinkRankingEntryCandidateまで
 * 行い、それ未満はalbum_match_logに記録するだけに留める。 */
export async function runGeminiMatchForAlbumEntry(entryId: number, rankingId: string): Promise<GeminiAlbumMatchResult> {
  const supabase = createAdminClient()

  const { data: entry } = await supabase
    .from('ranking_entry')
    .select('id, album:album_id(id, title, artist_id, artist:artist_id(id, name)), ranking:ranking_id(name)')
    .eq('id', entryId)
    .maybeSingle()
  if (!entry) return { status: 'error', message: '対象が見つかりません。' }

  const album = firstOf(entry.album)
  const artist = album ? firstOf(album.artist) : null
  const ranking = firstOf(entry.ranking)
  if (!album || !artist) return { status: 'error', message: 'アルバム情報が不足しています。' }

  const matched = await matchAlbumsWithCandidates(supabase, [
    { title: album.title, artist_name: artist.name, exclude_album_id: album.id },
  ])
  const candidates = matched[0]?.candidates ?? []
  if (candidates.length === 0) {
    return { status: 'no_match', message: '候補が見つかりませんでした。' }
  }

  const matchCandidates: AlbumMatchCandidate[] = candidates.map((c, index) => ({
    index,
    id: c.id,
    title: c.title,
    artistName: c.artist_name,
    similarity: c.similarity,
    source: c.id.startsWith('itunes:') ? 'apple_music' : 'local',
  }))

  let judgement
  try {
    judgement = await judgeAlbumMatchWithGemini(album.title, artist.name, ranking?.name ?? '選出企画', matchCandidates)
  } catch (err) {
    return { status: 'error', message: `Gemini判定に失敗しました: ${(err as Error).message}` }
  }

  const chosenCandidate = judgement.candidateIndex !== null ? candidates[judgement.candidateIndex] : null
  const autoApply = judgement.candidateIndex !== null && judgement.confidence >= AUTO_APPLY_THRESHOLD

  await supabase.from('album_match_log').insert({
    stub_album_id: album.id,
    stub_title: album.title,
    stub_artist_name: artist.name,
    ranking_id: rankingId,
    ranking_entry_id: entryId,
    chosen_candidate_id: chosenCandidate?.id ?? null,
    chosen_title: chosenCandidate?.title ?? null,
    chosen_artist_name: chosenCandidate?.artist_name ?? null,
    confidence: judgement.confidence,
    reasoning: judgement.reasoning,
    candidates_json: candidates,
    auto_applied: autoApply,
  })

  if (autoApply && chosenCandidate) {
    const linkResult = await linkRankingEntryCandidate(rankingId, entryId, album.id, artist.id, chosenCandidate.id)
    if (!linkResult.success) {
      return { status: 'error', message: `自動反映に失敗しました: ${linkResult.message}` }
    }
    revalidatePath(`/admin/data/curation/${rankingId}/match`)
    return { status: 'auto_applied', message: '自動反映しました。', confidence: judgement.confidence }
  }

  if (judgement.candidateIndex !== null) {
    return { status: 'needs_review', message: judgement.reasoning, confidence: judgement.confidence }
  }

  return { status: 'no_match', message: judgement.reasoning, confidence: judgement.confidence }
}

export type GeminiAlbumMatchRankingResult = {
  processed: number
  autoApplied: number
  needsReview: number
  noMatch: number
  errors: number
}

/** 指定企画配下の未マッチスタブ全件に対してGemini判定を一括実行する。
 * /admin/data/curation/{id}/matchの「Geminiで自動判定」ボタンから呼ぶ。
 * 未マッチの定義はpage.tsxと同じ(streaming_status=unreleased かつ
 * tower_url/discogs_urlどちらも未設定)。 */
export async function runGeminiMatchForRankingAlbums(rankingId: string): Promise<GeminiAlbumMatchRankingResult> {
  const supabase = createAdminClient()

  const { data: stubEntries } = await supabase
    .from('ranking_entry')
    .select('id, album:album_id!inner(streaming_status, tower_url, discogs_url)')
    .eq('ranking_id', rankingId)
    .eq('album.streaming_status', 'unreleased')
    .is('album.tower_url', null)
    .is('album.discogs_url', null)

  const result: GeminiAlbumMatchRankingResult = { processed: 0, autoApplied: 0, needsReview: 0, noMatch: 0, errors: 0 }

  for (const row of stubEntries ?? []) {
    result.processed += 1
    const r = await runGeminiMatchForAlbumEntry(row.id, rankingId)
    if (r.status === 'auto_applied') result.autoApplied += 1
    else if (r.status === 'needs_review') result.needsReview += 1
    else if (r.status === 'no_match') result.noMatch += 1
    else result.errors += 1
  }

  revalidatePath(`/admin/data/curation/${rankingId}/match`)
  return result
}

type ActionResult = { success: boolean; message: string }

/** 確信度0.5〜0.89の「要確認」判定を、管理者がその場で確定する。 */
export async function confirmAlbumMatchLog(logId: string): Promise<ActionResult> {
  const supabase = createAdminClient()

  const { data: log } = await supabase
    .from('album_match_log')
    .select('id, stub_album_id, ranking_id, ranking_entry_id, chosen_candidate_id, auto_applied, reverted')
    .eq('id', logId)
    .maybeSingle()
  if (!log) return { success: false, message: 'ログが見つかりません。' }
  if (log.auto_applied) return { success: false, message: '既に自動反映済みです。' }
  if (log.reverted) return { success: false, message: '取消済みの判定です。' }
  if (!log.chosen_candidate_id || !log.ranking_entry_id || !log.ranking_id) {
    return { success: false, message: '候補が選ばれていない判定です。' }
  }

  const { data: entry } = await supabase
    .from('ranking_entry')
    .select('album:album_id(id, artist_id)')
    .eq('id', log.ranking_entry_id)
    .maybeSingle()
  const album = entry ? firstOf(entry.album) : null

  const result = await linkRankingEntryCandidate(
    log.ranking_id,
    log.ranking_entry_id,
    album?.id ?? null,
    album?.artist_id ?? null,
    log.chosen_candidate_id
  )
  if (result.success) {
    await supabase.from('album_match_log').update({ auto_applied: true }).eq('id', logId)
    revalidatePath(`/admin/data/curation/${log.ranking_id}/match`)
  }
  return result
}

/** 自動反映済みの判定を取り消す。linkRankingEntryCandidateは確定時に元のスタブ
 * album/artist行を削除してしまう設計のため、単純にapple_music_artist_idを
 * nullに戻すような巻き戻しはできない。代わりに、ログに残るstub_title/
 * stub_artist_nameを元に新しい最小限スタブ(streaming_status: unreleased)を
 * 作り直し、ranking_entry.album_idをそちらへ差し戻す(=未マッチ状態への
 * 再スタブ化)。厳密な「元に戻す」ではない点に注意。 */
export async function revertAlbumMatchLog(logId: string): Promise<ActionResult> {
  const supabase = createAdminClient()

  const { data: log } = await supabase
    .from('album_match_log')
    .select('id, stub_title, stub_artist_name, ranking_id, ranking_entry_id, auto_applied, reverted')
    .eq('id', logId)
    .maybeSingle()
  if (!log) return { success: false, message: 'ログが見つかりません。' }
  if (!log.auto_applied) return { success: false, message: '自動反映されていない判定です。' }
  if (log.reverted) return { success: false, message: '既に取消済みです。' }
  if (!log.ranking_entry_id || !log.ranking_id) return { success: false, message: '企画情報が不足しています。' }

  let { data: artist } = await supabase.from('artist').select('id').eq('name', log.stub_artist_name).maybeSingle()
  if (!artist) {
    const { data: newArtist, error: artistError } = await supabase
      .from('artist')
      .insert({ name: log.stub_artist_name })
      .select('id')
      .single()
    if (artistError || !newArtist) {
      return { success: false, message: `アーティストの再作成に失敗しました: ${artistError?.message}` }
    }
    artist = newArtist
  }

  const { data: newAlbum, error: albumError } = await supabase
    .from('album')
    .insert({ title: log.stub_title, artist_id: artist.id, streaming_status: 'unreleased' })
    .select('id')
    .single()
  if (albumError || !newAlbum) {
    return { success: false, message: `アルバムの再作成に失敗しました: ${albumError?.message}` }
  }

  const { error: updateError } = await supabase
    .from('ranking_entry')
    .update({ album_id: newAlbum.id })
    .eq('id', log.ranking_entry_id)
  if (updateError) {
    return { success: false, message: `差し戻しに失敗しました: ${updateError.message}` }
  }

  await supabase.from('album_match_log').update({ reverted: true, reverted_at: new Date().toISOString() }).eq('id', logId)
  revalidatePath(`/admin/data/curation/${log.ranking_id}/match`)
  return { success: true, message: '未マッチのスタブに差し戻しました。' }
}
