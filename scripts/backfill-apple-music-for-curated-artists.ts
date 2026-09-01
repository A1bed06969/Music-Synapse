// Fender NEXT・Future of Musicで新規追加されたアーティストのうち、まだ
// apple_music_artist_idが無いもの(282組中111組)だけを対象にした、
// scripts/backfill-artist-apple-music-ids.tsのスコープ限定版。
// 全アーティスト向けの一括バッチを再実行すると、既に不一致・あいまい判定
// 済みの数千件を再処理して無駄が大きいため、この2つのキュレーションに
// 紐づくアーティストだけに絞って実行する。マッチングロジック・安全設計
// (完全一致1件のみ自動採用、1.2秒間隔、failed分は60秒待ってリトライ)は
// 同じ。
//
// 実行: npx tsx scripts/backfill-apple-music-for-curated-artists.ts

import { createClient } from '@supabase/supabase-js'
import { searchArtist } from '../utils/itunes'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const CANDIDATE_INTERVAL_MS = 1200
const CURATION_NAMES = ['Fender NEXT', 'Future of Music']

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type Candidate = { id: string; name: string; official_site_url: string | null }
type Outcome = 'matched' | 'ambiguous' | 'noMatch' | 'conflict' | 'failed'

async function fetchCandidates(): Promise<Candidate[]> {
  const { data: rankings, error: rankingError } = await supabase.from('ranking').select('id, name').in('name', CURATION_NAMES)
  if (rankingError) throw rankingError
  const rankingIds = (rankings ?? []).map((r) => r.id)
  if (rankingIds.length === 0) return []

  const artistIds = new Set<string>()
  let offset = 0
  const pageSize = 1000
  while (true) {
    const { data, error } = await supabase
      .from('ranking_entry')
      .select('artist_id')
      .in('ranking_id', rankingIds)
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    const page = data ?? []
    for (const row of page) artistIds.add(row.artist_id)
    if (page.length < pageSize) break
    offset += pageSize
  }

  const ids = [...artistIds]
  const candidates: Candidate[] = []
  // .in()の引数が多くなりすぎないよう300件ずつに分割
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300)
    const { data, error } = await supabase
      .from('artist')
      .select('id, name, official_site_url')
      .in('id', chunk)
      .is('apple_music_artist_id', null)
    if (error) throw error
    candidates.push(...(data ?? []))
  }
  return candidates
}

async function processCandidate(candidate: Candidate): Promise<Outcome> {
  const { id, name, official_site_url } = candidate
  try {
    const results = await searchArtist(name)
    const normTarget = normalize(name)
    const exactMatches = results.filter((r) => normalize(r.artistName) === normTarget)

    if (exactMatches.length !== 1) {
      return exactMatches.length === 0 ? 'noMatch' : 'ambiguous'
    }

    const candidateArtist = exactMatches[0]
    const appleId = String(candidateArtist.artistId)

    const { data: owner } = await supabase
      .from('artist')
      .select('id, name')
      .eq('apple_music_artist_id', appleId)
      .neq('id', id)
      .maybeSingle()

    if (owner) {
      console.log(`SKIP(重複): "${name}"(${id}) -> appleId ${appleId} は既に "${owner.name}" に紐付け済み`)
      return 'conflict'
    }

    const { error: updateError } = await supabase
      .from('artist')
      .update({
        apple_music_artist_id: appleId,
        official_site_url: official_site_url ?? candidateArtist.artistLinkUrl ?? null,
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (updateError) {
      console.error(`FAIL(更新失敗): "${name}"(${id}): ${updateError.message}`)
      return 'failed'
    }

    console.log(`MATCHED: "${name}"(${id}) -> "${candidateArtist.artistName}"(appleId=${appleId})`)
    return 'matched'
  } catch (err) {
    console.error(`ERROR: "${name}"(${id}) の処理中にエラー:`, err instanceof Error ? err.message : err)
    return 'failed'
  }
}

async function runBatch(
  candidates: Candidate[],
  progressLabel: string
): Promise<{ counts: Record<Outcome, number>; failedCandidates: Candidate[] }> {
  const counts: Record<Outcome, number> = { matched: 0, ambiguous: 0, noMatch: 0, conflict: 0, failed: 0 }
  const failedCandidates: Candidate[] = []

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    const outcome = await processCandidate(candidate)
    counts[outcome]++
    if (outcome === 'failed') failedCandidates.push(candidate)

    if (i < candidates.length - 1) await sleep(CANDIDATE_INTERVAL_MS)

    if ((i + 1) % 20 === 0 || i === candidates.length - 1) {
      console.log(
        `--- ${progressLabel} ${i + 1}/${candidates.length}: matched=${counts.matched}, ambiguous=${counts.ambiguous}, noMatch=${counts.noMatch}, conflict=${counts.conflict}, failed=${counts.failed} ---`
      )
    }
  }

  return { counts, failedCandidates }
}

async function main() {
  const candidates = await fetchCandidates()
  console.log(`=== 開始: 対象${candidates.length}件(Fender NEXT + Future of Music) ===`)

  const first = await runBatch(candidates, '進捗')

  let retryCounts: Record<Outcome, number> | null = null
  if (first.failedCandidates.length > 0) {
    console.log(`--- 1周目でfailedだった${first.failedCandidates.length}件を60秒待ってからリトライ ---`)
    await sleep(60000)
    const retry = await runBatch(first.failedCandidates, 'リトライ進捗')
    retryCounts = retry.counts
  }

  const totalMatched = first.counts.matched + (retryCounts?.matched ?? 0)
  const totalAmbiguous = first.counts.ambiguous + (retryCounts?.ambiguous ?? 0)
  const totalNoMatch = first.counts.noMatch + (retryCounts?.noMatch ?? 0)
  const totalConflict = first.counts.conflict + (retryCounts?.conflict ?? 0)
  const totalFailed = retryCounts?.failed ?? first.counts.failed

  console.log(
    `=== 完了: matched=${totalMatched}, ambiguous=${totalAmbiguous}, noMatch=${totalNoMatch}, conflict=${totalConflict}, failed=${totalFailed} (対象${candidates.length}件) ===`
  )
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
