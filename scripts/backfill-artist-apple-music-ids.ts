// アーティスト単体のApple Music ID未紐付け(3097件)を、iTunes Artist Searchの
// 完全一致(かつ候補が1件のみ)という保守的な条件でのみ自動紐付けする一括バッチ。
// 過検出より過小検出を優先する(あいまいな場合は自動リンクせず手動レビューに残す)。
// 既存のitunes-mergeページ(1件ずつの手動統合UI)と同じロジックだが、アルバム/
// トラックの同期(dispatchAlbumSync)はこのバッチからは行わない。理由: 同期は
// /api/admin/album-syncのafter()内で別プロセス(next devサーバー)上を数分かけて
// 非同期に走り続け、1アーティストごとにアルバム/トラック単位でiTunesを何度も
// 叩く。utils/itunes.tsのレート制限カウンタはプロセスごとに独立しているため、
// マッチが積み重なるほど裏で同時進行する同期チェーンが増え、このスクリプト自身の
// 検索リクエストと合算でAppleの非公式なレート制限を超過し、実際に3200件バッチの
// 中盤(150件時点)で失敗率が84%まで悪化する事態を引き起こした。ID紐付け自体が
// このバッチの目的であり、アルバム同期は関心事として分離できるため、ここでは
// 呼ばない。同期は紐付け後に別途 scripts/sync-recently-linked-artists.ts 等で
// 落ち着いたペースで行う想定。
//
// 実行: npx tsx scripts/backfill-artist-apple-music-ids.ts
// (next devサーバーは不要 — Supabaseへの直接書き込みのみ)

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { searchArtist } from '../utils/itunes'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const LOG_PATH = path.join(
  '/private/tmp/claude-501/-Users-th-dev-music-synapse/636c6505-a754-42fb-9059-5d744733fc56/scratchpad',
  'apple-music-backfill.log'
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

// utils/itunes.tsのfetchItunes側にも400ms間隔+403/429時の指数バックオフは
// 入っているが、それでも実際に3200件バッチの初動でERROR率が上がっていく
// (403/429が連発する)のを確認したため、このスクリプト独自にさらに保守的な
// 間隔(候補1件ごとに1.5秒)を追加する。iTunes Search APIの実際のレート制限は
// 明文化されていないが、経験的に400ms間隔(理論値150req/分)では超過する。
const CANDIDATE_INTERVAL_MS = 1500

async function fetchCandidates(): Promise<{ id: string; name: string; official_site_url: string | null }[]> {
  const rows: { id: string; name: string; official_site_url: string | null }[] = []
  let offset = 0
  const pageSize = 1000
  while (true) {
    const { data, error } = await supabase
      .from('artist')
      .select('id, name, official_site_url')
      .is('apple_music_artist_id', null)
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

type Candidate = { id: string; name: string; official_site_url: string | null }
type Outcome = 'matched' | 'ambiguous' | 'noMatch' | 'conflict' | 'failed'

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
      log(`SKIP(重複): "${name}"(${id}) -> appleId ${appleId} は既に "${owner.name}" に紐付け済み`)
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
      log(`FAIL(更新失敗): "${name}"(${id}): ${updateError.message}`)
      return 'failed'
    }

    log(`MATCHED: "${name}"(${id}) -> "${candidateArtist.artistName}"(appleId=${appleId})`)
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
