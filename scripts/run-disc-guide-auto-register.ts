// scripts/run-disc-guide-auto-register.ts
//
// OCR済み(確認待ち)のディスクガイドのページを、1作品ずつ自動登録する
// (/api/admin/disc-guide-scan/auto-register)。確実に特定できなかった作品は確認画面に残る。
// 何度実行しても、登録済みの作品は飛ばす。ローカルdevサーバーを起動した状態で実行すること。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/run-disc-guide-auto-register.ts <discGuideId> [<discGuideId> ...]
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchDevServer } from '@/utils/devServerFetch'
import { internalApiBaseUrl } from '@/utils/internalApiBaseUrl'

const BASE_URL = internalApiBaseUrl()
const authHeader =
  'Basic ' + Buffer.from(`${process.env.BASIC_AUTH_USER}:${process.env.BASIC_AUTH_PASSWORD}`).toString('base64')

async function main() {
  const guideIds = process.argv.slice(2)
  if (guideIds.length === 0) {
    console.error('使い方: npx tsx --env-file=.env.local scripts/run-disc-guide-auto-register.ts <discGuideId> ...')
    process.exit(1)
  }
  const supabase = createAdminClient()
  for (const guideId of guideIds) {
    const { data: pages } = await supabase
      .from('disc_guide_scan_pending')
      .select('id, image_filename, extracted_data, registered_indices')
      .eq('disc_guide_id', guideId)
      .eq('status', 'pending')
      .order('image_filename')
    const tally: Record<string, number> = {}
    let llmExhausted = false
    console.log(`${guideId}: 確認待ち ${pages?.length ?? 0}ページ`)
    for (const [pi, page] of (pages ?? []).entries()) {
      const items = Array.isArray(page.extracted_data) ? page.extracted_data : []
      for (let index = 0; index < items.length; index++) {
        if ((page.registered_indices ?? []).includes(index)) continue
        const res = await fetchDevServer(`${BASE_URL}/api/admin/disc-guide-scan/auto-register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: JSON.stringify({ pending_id: page.id, index }),
        })
        const json = (await res.json().catch(() => ({}))) as { status?: string; reason?: string }
        const status = json.status ?? `error(${res.status})`
        tally[status] = (tally[status] ?? 0) + 1
        if (json.reason && /LLM判定に失敗/.test(json.reason)) llmExhausted = true
      }
      console.log(`  ${pi + 1}/${pages?.length}ページ ${JSON.stringify(tally)}`)
      if (llmExhausted) {
        console.log('LLMの無料枠が尽きたため止めます。枠の回復後に同じコマンドで続きから処理します。')
        return
      }
    }
    console.log(`${guideId} 完了: ${JSON.stringify(tally)}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
