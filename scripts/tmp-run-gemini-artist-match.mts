// ②の未マッチスタブ(NME100/RADAR等)をGeminiで一括判定する一回限りの実行用スクリプト。
// 実行: npx tsx --env-file=.env.local scripts/tmp-run-gemini-artist-match.mts "<ranking id>"
import { runGeminiMatchForRanking } from '@/app/admin/data/artists/unmatched/geminiMatchActions'

async function main() {
  const rankingId = process.argv[2]
  if (!rankingId) {
    console.error('使い方: npx tsx --env-file=.env.local scripts/tmp-run-gemini-artist-match.mts "<ranking id>"')
    process.exit(1)
  }
  const result = await runGeminiMatchForRanking(rankingId)
  console.log(JSON.stringify(result, null, 2))
}

main()
