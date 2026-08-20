// scripts/backfill-disc-guide-itunes-candidates.ts
/**
 * matchAlbumsWithCandidates(utils/discGuideImport.ts)にApple Musicカタログ検索を
 * 追加した際、既にOCR済み(disc_guide_scan_pending, status='pending')のレコードは
 * 古いmatched_data(自前DBのみの候補)のまま残ってしまう。OCR(Gemini)は再実行せず、
 * 保存済みのextracted_dataから候補だけを再計算してmatched_dataを更新する。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/backfill-disc-guide-itunes-candidates.ts
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { matchAlbumsWithCandidates, type AlbumExtract } from '@/utils/discGuideImport'

async function main() {
  const supabase = createAdminClient()

  const { data: rows, error } = await supabase
    .from('disc_guide_scan_pending')
    .select('id, extracted_data')
    .eq('status', 'pending')

  if (error) {
    console.error('取得に失敗しました:', error.message)
    process.exit(1)
  }

  if (!rows || rows.length === 0) {
    console.log('対象のレコードはありません。')
    return
  }

  console.log(`対象: ${rows.length}件\n`)

  let done = 0
  for (const row of rows) {
    const extracted = (row.extracted_data ?? []) as AlbumExtract[]
    if (extracted.length === 0) {
      done++
      continue
    }

    const matched = await matchAlbumsWithCandidates(supabase, extracted)
    const { error: updateError } = await supabase
      .from('disc_guide_scan_pending')
      .update({ matched_data: matched })
      .eq('id', row.id)

    done++
    if (updateError) {
      console.error(`[${done}/${rows.length}] ${row.id}: 更新失敗 - ${updateError.message}`)
    } else {
      console.log(`[${done}/${rows.length}] ${row.id}: 更新完了`)
    }
  }

  console.log(`\n完了: ${done}件処理。`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
