// scripts/verify-radio-pick-matches.ts
//
// radio_airplay_pickの「マッチ済み・未登録」(candidate_collection_idは設定済みだが
// registered_rotation_idが未設定)を対象に、Geminiで既存候補の文脈込み再検証を行う。
//
// 背景: これらの候補はscripts/backfill-radio-pick-itunes-candidates.ts等による
// 「artist_name+track_titleでのiTunes検索、上位1件を機械的に採用」で付いたもので、
// 人力確認前提のまま2000件超が溜まっている(2026-09-06時点)。局名・番組名・
// 選出日・国内外フラグという文脈をGeminiに渡し、確信度90%以上なら
// registerPickIdToRotationでそのまま本登録、50%未満で明確に別物と判定されれば
// 候補をクリアして未マッチへ差し戻す。中間はradio_pick_match_logに記録するのみで
// 現状(マッチ済み・未登録)を維持する。
//
// registerPickIdToRotation(app/admin/data/media/radio-airplay-pick/actions.ts)は
// 内部でrevalidatePathを呼ぶが、utils/safeRevalidate.ts経由にしてあるため
// このスクリプト(Next.jsのリクエストライフサイクル外)から直接importして呼んでも
// 例外にならない。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/verify-radio-pick-matches.ts [--limit=N]
import { createAdminClient } from '@/utils/Supabase/admin'
import { runGeminiVerifyForOneMatch } from '@/app/admin/data/media/radio-airplay-pick/geminiMatchActions'

const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : undefined

async function main() {
  const supabase = createAdminClient()

  const targetIds: string[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('radio_airplay_pick')
      .select('id')
      .not('candidate_collection_id', 'is', null)
      .is('registered_rotation_id', null)
      .order('picked_date', { ascending: true })
      .range(offset, offset + pageSize - 1)
    const page = data ?? []
    targetIds.push(...page.map((r) => r.id as string))
    if (page.length < pageSize) break
    offset += pageSize
  }

  const targets = LIMIT ? targetIds.slice(0, LIMIT) : targetIds
  console.log(`対象: ${targets.length}件\n`)

  let registered = 0
  let cleared = 0
  let needsReview = 0
  let errors = 0

  for (const [index, pickId] of targets.entries()) {
    try {
      const result = await runGeminiVerifyForOneMatch(pickId)
      console.log(`[${index + 1}/${targets.length}] ${pickId}: ${result.status}(確信度${Math.round((result.confidence ?? 0) * 100)}%) ${result.message}`)
      if (result.status === 'registered') registered += 1
      else if (result.status === 'cleared') cleared += 1
      else if (result.status === 'needs_review') needsReview += 1
      else errors += 1
    } catch (err) {
      errors += 1
      console.error(`[${index + 1}/${targets.length}] ${pickId}: 予期しないエラー:`, (err as Error).message)
    }
  }

  console.log('\n=== 完了 ===')
  console.log(`本登録: ${registered}件`)
  console.log(`候補クリア(未マッチへ差し戻し): ${cleared}件`)
  console.log(`要確認(現状維持): ${needsReview}件`)
  console.log(`エラー: ${errors}件`)
}

main()
