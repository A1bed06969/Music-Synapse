import { runGeminiMatchForRanking } from '@/app/admin/data/artists/unmatched/geminiMatchActions'

const RANKINGS = [
  { id: 'MS_RNK_w87v7u9c', name: 'The NME 100' },
  { id: 'MS_RNK_0yhtlfy7', name: 'Fender NEXT' },
]

for (const ranking of RANKINGS) {
  console.log(`\n=== ${ranking.name} (${ranking.id}) ===`)
  try {
    const result = await runGeminiMatchForRanking(ranking.id)
    console.log(JSON.stringify(result, null, 2))
  } catch (err) {
    // revalidatePath()はNext.jsのリクエストコンテキスト外だと失敗するが、
    // その時点で判定・DB書き込み自体は既に完了しているため無視してよい
    console.log(`(revalidatePath等の後処理でエラーが出ましたが、判定自体は完了しています: ${(err as Error).message})`)
  }
}

console.log('\n全企画の処理が完了しました。')
