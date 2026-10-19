// scripts/match-unmatched-radio-picks.ts
/**
 * radio_airplay_pick の未マッチ(candidate_track_id / candidate_collection_id がどちらも未設定)を、
 * Apple Musicの複数候補からGeminiに選ばせて付け直す(管理画面の「Geminiで一括マッチング」と同じ処理)。
 * 確信度が高いものは自動で候補に反映され、中間のものは radio_pick_match_log に残るだけになる。
 * 候補が付いたあとの本登録は scripts/verify-radio-pick-matches.ts で行う。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/match-unmatched-radio-picks.ts [--region=TV] [--limit=N]
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { runGeminiMatchForOnePick } from '@/app/admin/data/media/radio-airplay-pick/geminiMatchActions'

const REGION = (process.argv.find((a) => a.startsWith('--region=')) ?? '').replace('--region=', '')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : undefined

async function main() {
  const supabase = createAdminClient()
  const ids: string[] = []
  for (let offset = 0; ; offset += 1000) {
    let query = supabase
      .from('radio_airplay_pick')
      .select('id')
      .is('candidate_track_id', null)
      .is('candidate_collection_id', null)
      .not('artist_name', 'is', null)
      .not('track_title', 'is', null)
    if (REGION) query = query.eq('region', REGION)
    const { data } = await query.order('picked_date', { ascending: true }).range(offset, offset + 999)
    ids.push(...(data ?? []).map((r) => r.id as string))
    if ((data ?? []).length < 1000) break
  }
  const targets = LIMIT ? ids.slice(0, LIMIT) : ids
  console.log(`対象: ${targets.length}件\n`)

  const count = { auto_applied: 0, needs_review: 0, no_match: 0, error: 0 }
  for (const [i, id] of targets.entries()) {
    const r = await runGeminiMatchForOnePick(id)
    count[r.status as keyof typeof count] = (count[r.status as keyof typeof count] ?? 0) + 1
    console.log(`[${i + 1}/${targets.length}] ${id}: ${r.status} ${r.message.slice(0, 80)}`)
    if (r.status === 'error' && /無料枠|429|quota/i.test(r.message)) {
      console.log('LLMの無料枠が尽きたため止めます。枠の回復後に同じコマンドで続きから処理します。')
      break
    }
  }
  console.log('\n=== 完了 ===')
  console.log(`自動反映: ${count.auto_applied}件 / 要確認: ${count.needs_review}件 / 該当なし: ${count.no_match}件 / エラー: ${count.error}件`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
