// scripts/backfill-radio-station-urls.ts
//
// media.power_play_url を、事前に調査したURLで一括更新する。ラジオ局PP自動収集
// (app/api/cron/radio-power-play)の対象を広げるための一度きりの実行用スクリプト。
// 新しく局のURLが判明するたびに、下記のマッピングに追記して再実行する
// (既存の値を上書きするだけなので、再実行しても安全)。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/backfill-radio-station-urls.ts
import { createAdminClient } from '@/utils/Supabase/admin'

// 局名(mediaテーブルのnameと完全一致させる) → パワープレイ/ヘビーローテーション
// ページのURL。判明した局から追記していく(utils/radioScrape.tsの3局は
// 既に動作実績のあるURLをそのまま転記した)。
const STATION_URLS: Record<string, string> = {
  'J-WAVE': 'https://www.j-wave.co.jp/special/sonartrax/',
  'FM福井': 'https://www.fmfukui.jp/heavyrotation/',
  'エフエム・ノースウェーブ': 'https://www.fmnorth.co.jp/megaplay/',
}

async function main() {
  const supabase = createAdminClient()
  let updated = 0
  let notFound = 0

  for (const [stationName, url] of Object.entries(STATION_URLS)) {
    const { data, error } = await supabase
      .from('media')
      .update({ power_play_url: url })
      .eq('name', stationName)
      .select('id')

    if (error) {
      console.error(`❌ ${stationName}: ${error.message}`)
      continue
    }
    if (!data || data.length === 0) {
      console.log(`⚠️ ${stationName}: mediaテーブルに該当局が見つかりませんでした`)
      notFound++
      continue
    }
    console.log(`✅ ${stationName}: ${url}`)
    updated++
  }

  console.log(`\n完了: ${updated}件更新、${notFound}件未発見`)
}

main()
