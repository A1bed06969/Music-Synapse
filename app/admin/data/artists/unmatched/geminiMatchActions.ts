'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchArtistWithAlbums } from '@/utils/itunes'
import { judgeArtistMatchWithGemini, type MatchCandidate, type ArticleContext } from '@/utils/geminiArtistMatch'
import { searchAppleMusicArtistForStub, linkStubArtistToItunes, type ItunesArtistSearchResultWithImage } from './actions'

// 確信度がこれ以上の場合のみ自動反映する。同名多数のケース(例:「Ciel」)を
// 安全側に倒すため、意図的に厳しめの値にしている。閾値未満は今まで通り
// 人力レビューのキューに残る。
const AUTO_APPLY_THRESHOLD = 0.9

async function buildMatchCandidates(candidates: ItunesArtistSearchResultWithImage[]): Promise<MatchCandidate[]> {
  return Promise.all(
    candidates.map(async (c, index) => {
      try {
        const { albums } = await fetchArtistWithAlbums(String(c.artistId), c.country)
        const sorted = [...albums].sort((a, b) => (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999'))
        const earliestReleaseYear = sorted[0]?.releaseDate ? Number(sorted[0].releaseDate.slice(0, 4)) : null
        const albumTitles = Array.from(new Set(albums.map((a) => a.collectionName))).slice(0, 5)
        return {
          index,
          artistName: c.artistName,
          primaryGenreName: c.primaryGenreName,
          country: c.country,
          earliestReleaseYear,
          albumTitles,
        }
      } catch {
        return {
          index,
          artistName: c.artistName,
          primaryGenreName: c.primaryGenreName,
          country: c.country,
          earliestReleaseYear: null,
          albumTitles: [],
        }
      }
    })
  )
}

export type GeminiMatchStubResult = {
  status: 'auto_applied' | 'needs_review' | 'no_match' | 'error'
  message: string
  confidence?: number
}

/** 1件のスタブアーティストについて、選出元の記事コンテキスト(あれば)を添えて
 * Geminiに候補判定させる。確信度が閾値以上なら即座に紐付けまで行い、
 * それ未満は判定結果をartist_match_logに記録するだけに留める(既存の
 * 未マッチ一覧UIから人力で確認・確定できる)。 */
export async function runGeminiMatchForStub(stubArtistId: string, rankingId: string): Promise<GeminiMatchStubResult> {
  const supabase = createAdminClient()

  const { data: stub } = await supabase.from('artist').select('id, name').eq('id', stubArtistId).maybeSingle()
  if (!stub) return { status: 'error', message: '対象のアーティストが見つかりません。' }

  const { data: entry } = await supabase
    .from('ranking_entry')
    .select('period_date, ranking:ranking_id(name)')
    .eq('artist_id', stubArtistId)
    .eq('ranking_id', rankingId)
    .maybeSingle()
  const ranking = entry ? (Array.isArray(entry.ranking) ? entry.ranking[0] : entry.ranking) : null
  const year = entry?.period_date ? Number(String(entry.period_date).slice(0, 4)) : null
  const rankingContext = ranking?.name ? `${ranking.name}${year ? ` ${year}年版` : ''}` : '新人アーティスト選出企画'

  let articleContext: ArticleContext | null = null
  if (year) {
    const { data: sourceUrl } = await supabase
      .from('ranking_source_url')
      .select('id')
      .eq('ranking_id', rankingId)
      .eq('year', year)
      .maybeSingle()
    if (sourceUrl) {
      const { data: contextRow } = await supabase
        .from('ranking_article_context')
        .select('from_location, for_fans_of, key_track, bio_snippet')
        .eq('ranking_source_url_id', sourceUrl.id)
        .ilike('artist_name', stub.name)
        .maybeSingle()
      if (contextRow) {
        articleContext = {
          from: contextRow.from_location ?? undefined,
          forFansOf: contextRow.for_fans_of ?? undefined,
          keyTrack: contextRow.key_track ?? undefined,
          bioSnippet: contextRow.bio_snippet ?? undefined,
        }
      }
    }
  }

  const candidates = await searchAppleMusicArtistForStub(stub.name)
  if (candidates.length === 0) {
    return { status: 'no_match', message: 'Apple Musicで候補が見つかりませんでした。' }
  }

  const matchCandidates = await buildMatchCandidates(candidates)

  let judgement
  try {
    judgement = await judgeArtistMatchWithGemini(stub.name, rankingContext, articleContext, matchCandidates)
  } catch (err) {
    return { status: 'error', message: `Gemini判定に失敗しました: ${(err as Error).message}` }
  }

  const chosenCandidate = judgement.candidateIndex !== null ? candidates[judgement.candidateIndex] : null
  const autoApply = judgement.candidateIndex !== null && judgement.confidence >= AUTO_APPLY_THRESHOLD

  await supabase.from('artist_match_log').insert({
    stub_artist_id: stubArtistId,
    stub_artist_name: stub.name,
    ranking_id: rankingId,
    chosen_apple_music_artist_id: chosenCandidate ? String(chosenCandidate.artistId) : null,
    chosen_artist_name: chosenCandidate?.artistName ?? null,
    chosen_country: chosenCandidate?.country ?? null,
    confidence: judgement.confidence,
    reasoning: judgement.reasoning,
    candidates_json: candidates,
    auto_applied: autoApply,
  })

  if (autoApply && chosenCandidate) {
    const linkResult = await linkStubArtistToItunes(stubArtistId, chosenCandidate.artistId, chosenCandidate.country)
    if (!linkResult.success) {
      return { status: 'error', message: `自動反映に失敗しました: ${linkResult.message}` }
    }
    revalidatePath('/admin/data/artists/unmatched')
    return {
      status: 'auto_applied',
      message: `「${linkResult.registeredName}」に自動反映しました。`,
      confidence: judgement.confidence,
    }
  }

  if (judgement.candidateIndex !== null) {
    return {
      status: 'needs_review',
      message: judgement.reasoning,
      confidence: judgement.confidence,
    }
  }

  return { status: 'no_match', message: judgement.reasoning, confidence: judgement.confidence }
}

export type GeminiMatchRankingResult = {
  processed: number
  autoApplied: number
  needsReview: number
  noMatch: number
  errors: number
}

/** 指定企画(ranking)配下の未マッチスタブ全件に対してGemini判定を一括実行する。
 * /admin/data/artists/unmatchedの「Geminiで自動判定」ボタンから呼ぶ。 */
export async function runGeminiMatchForRanking(rankingId: string): Promise<GeminiMatchRankingResult> {
  const supabase = createAdminClient()

  const { data: stubs } = await supabase
    .from('ranking_entry')
    .select('artist:artist_id!inner(id, apple_music_artist_id)')
    .eq('ranking_id', rankingId)
    .is('artist.apple_music_artist_id', null)

  const result: GeminiMatchRankingResult = { processed: 0, autoApplied: 0, needsReview: 0, noMatch: 0, errors: 0 }

  for (const row of stubs ?? []) {
    const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
    if (!artist) continue
    result.processed += 1
    const r = await runGeminiMatchForStub(artist.id, rankingId)
    if (r.status === 'auto_applied') result.autoApplied += 1
    else if (r.status === 'needs_review') result.needsReview += 1
    else if (r.status === 'no_match') result.noMatch += 1
    else result.errors += 1
  }

  revalidatePath('/admin/data/artists/unmatched')
  return result
}

/** 確信度0.5〜0.89の「要確認」判定を、管理者がその場で確定する
 * (Geminiが選んだ候補をそのまま採用)。候補が見当たらない・違うと思った場合は
 * 何もせず、既存の未マッチ一覧から手動で検索し直せばよい。 */
export async function confirmGeminiMatchLog(logId: string): Promise<LinkStubResultLike> {
  const supabase = createAdminClient()

  const { data: log } = await supabase
    .from('artist_match_log')
    .select('id, stub_artist_id, chosen_apple_music_artist_id, chosen_country, auto_applied, reverted')
    .eq('id', logId)
    .maybeSingle()
  if (!log) return { success: false, message: 'ログが見つかりません。' }
  if (log.auto_applied) return { success: false, message: '既に自動反映済みです。' }
  if (log.reverted) return { success: false, message: '取消済みの判定です。' }
  if (!log.chosen_apple_music_artist_id) return { success: false, message: '候補が選ばれていない判定です。' }

  const result = await linkStubArtistToItunes(
    log.stub_artist_id,
    Number(log.chosen_apple_music_artist_id),
    log.chosen_country ?? 'JP'
  )
  if (result.success) {
    await supabase.from('artist_match_log').update({ auto_applied: true }).eq('id', logId)
    revalidatePath('/admin/data/artists/unmatched')
  }
  return result
}

type LinkStubResultLike = { success: true; registeredName: string } | { success: false; message: string }

/** 自動反映済みの判定を取り消す(Apple Musicとの紐付けを解除するのみ)。
 * 既に同期されたアルバム・トラックは自動では削除しない(誤って途中まで
 * 育った実データを巻き込んで消してしまう方が危険なため)。取消後に別の候補で
 * 改めて紐付ける場合は、同期済みデータの扱いを手動で確認すること。 */
export async function revertGeminiMatchLog(logId: string): Promise<{ success: boolean; message: string }> {
  const supabase = createAdminClient()

  const { data: log } = await supabase
    .from('artist_match_log')
    .select('id, stub_artist_id, stub_artist_name, auto_applied, reverted')
    .eq('id', logId)
    .maybeSingle()
  if (!log) return { success: false, message: 'ログが見つかりません。' }
  if (!log.auto_applied) return { success: false, message: '自動反映されていない判定です。' }
  if (log.reverted) return { success: false, message: '既に取消済みです。' }

  const { error } = await supabase
    .from('artist')
    .update({
      name: log.stub_artist_name,
      apple_music_artist_id: null,
      apple_music_country: 'JP',
    })
    .eq('id', log.stub_artist_id)
  if (error) return { success: false, message: `取消に失敗しました: ${error.message}` }

  await supabase.from('artist_match_log').update({ reverted: true, reverted_at: new Date().toISOString() }).eq('id', logId)
  revalidatePath('/admin/data/artists/unmatched')
  return { success: true, message: '紐付けを解除しました。既に同期されたアルバム等は手動でご確認ください。' }
}
