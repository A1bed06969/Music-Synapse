// アーティスト単体のDiscogs ID未紐付けを、Discogsのアーティスト検索の完全一致
// (かつ候補が1件のみ)という保守的な条件でのみ自動紐付けする一括バッチ。
// 過検出より過小検出を優先する(あいまいな場合は自動リンクせず手動レビューに残す)。
// scripts/backfill-artist-apple-music-ids.tsと同じ構造・同じ安全設計を踏襲。
//
// Discogs APIは認証済みで60req/分という明文化された上限があり(iTunes Search
// APIの非公式・不安定な制限とは違う)、utils/discogs.tsのfetchDiscogs自体が
// 呼び出しごとに600ms待つ。それに加えてこのスクリプトでも候補1件ごとに1.2秒
// 待つため、実質は約33req/分でこの上限に十分な余裕を持たせている。
//
// 実行: npx tsx scripts/backfill-artist-discogs-ids.ts
// (next devサーバーは不要 — Supabaseへの直接書き込みのみ)

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { searchArtist } from '../utils/discogs'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const LOG_PATH = path.join(
  '/private/tmp/claude-501/-Users-th-dev-music-synapse/636c6505-a754-42fb-9059-5d744733fc56/scratchpad',
  'discogs-backfill.log'
)

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_PATH, line + '\n')
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const CANDIDATE_INTERVAL_MS = 1200

type Candidate = { id: string; name: string }
type Outcome = 'matched' | 'ambiguous' | 'noMatch' | 'conflict' | 'failed'

async function fetchCandidates(): Promise<Candidate[]> {
  const rows: Candidate[] = []
  let offset = 0
  const pageSize = 1000
  while (true) {
    const { data, error } = await supabase
      .from('artist')
      .select('id, name')
      .is('discogs_artist_id', null)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }
  return rows
}

async function processCandidate(candidate: Candidate): Promise<Outcome> {
  const { id, name } = candidate
  try {
    const results = await searchArtist(name)
    const normTarget = normalize(name)
    const exactMatches = results.filter((r) => normalize(r.name) === normTarget)

    if (exactMatches.length !== 1) {
      return exactMatches.length === 0 ? 'noMatch' : 'ambiguous'
    }

    const discogsId = String(exactMatches[0].discogsId)

    const { data: owner } = await supabase
      .from('artist')
      .select('id, name')
      .eq('discogs_artist_id', discogsId)
      .neq('id', id)
      .maybeSingle()

    if (owner) {
      log(`SKIP(重複): "${name}"(${id}) -> discogsId ${discogsId} は既に "${owner.name}" に紐付け済み`)
      return 'conflict'
    }

    const { error: updateError } = await supabase.from('artist').update({ discogs_artist_id: discogsId }).eq('id', id)

    if (updateError) {
      log(`FAIL(更新失敗): "${name}"(${id}): ${updateError.message}`)
      return 'failed'
    }

    log(`MATCHED: "${name}"(${id}) -> discogsId=${discogsId}`)
    return 'matched'
  } catch (err) {
    log(`ERROR: "${name}"(${id}) の処理中にエラー: ${err instanceof Error ? err.message : err}`)
    return 'failed'
  }
}

/** candidatesを順番に処理し、集計とfailed分のリストを返す。呼び出し元
 * (通常パス・リトライパス)で同じロジックを再利用する。 */
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

    if ((i + 1) % 50 === 0 || i === candidates.length - 1) {
      log(
        `--- ${progressLabel} ${i + 1}/${candidates.length}: matched=${counts.matched}, ambiguous=${counts.ambiguous}, noMatch=${counts.noMatch}, conflict=${counts.conflict}, failed=${counts.failed} ---`
      )
    }
  }

  return { counts, failedCandidates }
}

async function main() {
  const candidates = await fetchCandidates()
  log(`=== 開始: 対象${candidates.length}件 ===`)

  const first = await runBatch(candidates, '進捗')

  let retryCounts: Record<Outcome, number> | null = null
  if (first.failedCandidates.length > 0) {
    log(`--- 1周目でfailedだった${first.failedCandidates.length}件を60秒待ってからリトライ ---`)
    await sleep(60000)
    const retry = await runBatch(first.failedCandidates, 'リトライ進捗')
    retryCounts = retry.counts
  }

  const totalMatched = first.counts.matched + (retryCounts?.matched ?? 0)
  const totalAmbiguous = first.counts.ambiguous + (retryCounts?.ambiguous ?? 0)
  const totalNoMatch = first.counts.noMatch + (retryCounts?.noMatch ?? 0)
  const totalConflict = first.counts.conflict + (retryCounts?.conflict ?? 0)
  const totalFailed = retryCounts?.failed ?? first.counts.failed

  log(
    `=== 完了: matched=${totalMatched}, ambiguous=${totalAmbiguous}, noMatch=${totalNoMatch}, conflict=${totalConflict}, failed=${totalFailed} (対象${candidates.length}件) ===`
  )
}

main().catch((err) => {
  log(`FATAL: ${err instanceof Error ? err.stack ?? err.message : err}`)
  process.exit(1)
})
