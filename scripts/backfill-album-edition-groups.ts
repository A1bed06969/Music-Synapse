// scripts/backfill-album-edition-groups.ts
/**
 * アルバム版統合(utils/applyEditionGrouping.ts)をカタログ全体に対して実行する。
 * 通常の登録経路(iTunes一括登録・イベント経由登録・検索登録)ではアーティスト単位で
 * 自動実行されるため、このスクリプトは取りこぼしを拾うための定期実行・手動実行用。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/backfill-album-edition-groups.ts
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { applyEditionGrouping } from '@/utils/applyEditionGrouping'

async function main() {
  const supabase = createAdminClient()
  const result = await applyEditionGrouping(supabase)

  if (result.groupsDetected === 0) {
    console.log('グループ化対象のアルバムはありません。')
    return
  }

  console.log(
    `完了: ${result.groupsDetected}件のグループを検出、${result.updated}件を適用、${result.skipped}件スキップ、${result.failed}件失敗。`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
