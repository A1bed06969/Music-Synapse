// scripts/import-hrpp-radio-picks.ts
/**
 * ユーザーの個人収集スプレッドシート(HRPPシート)から抽出したラジオ/TV局の
 * パワープレイ・推薦曲データ(JSON)を radio_airplay_pick に一括投入する。
 * Apple Music候補IDの付与は別スクリプト(backfill-radio-pick-itunes-candidates.ts)で行う。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/import-hrpp-radio-picks.ts <picks.jsonのパス>
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { readFileSync } from 'fs'

type Pick = {
  region: string
  station_name: string
  campaign_name: string | null
  picked_date: string
  artist_name: string | null
  track_title: string | null
  is_domestic: boolean | null
}

async function main() {
  const jsonPath = process.argv[2]
  if (!jsonPath) {
    console.error('使い方: npx tsx --env-file=.env.local scripts/import-hrpp-radio-picks.ts <picks.jsonのパス>')
    process.exit(1)
  }

  const picks: Pick[] = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  console.log(`対象: ${picks.length}件`)

  const supabase = createAdminClient()
  const chunkSize = 500
  let inserted = 0

  for (let i = 0; i < picks.length; i += chunkSize) {
    const chunk = picks.slice(i, i + chunkSize)
    const { error } = await supabase.from('radio_airplay_pick').insert(chunk)
    if (error) {
      console.error(`[${i}-${i + chunk.length}] 挿入失敗: ${error.message}`)
      process.exit(1)
    }
    inserted += chunk.length
    console.log(`${inserted}/${picks.length}件 挿入完了`)
  }

  console.log('完了。')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
