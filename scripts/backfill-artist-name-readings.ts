// scripts/backfill-artist-name-readings.ts
//
// 名前が漢字で始まり読み(name_kana)が無いアーティストに、LLMでカタカナの読みを付ける。
// 読みはsort_key(並び順・頭文字フィルター)に使われるため、漢字の名前のままだと
// 五十音の行に入らない。既存のname_kanaに合わせてカタカナで保存する。
//
// 誤った読みを入れないよう、確信度が高いものだけ保存し、自信が無いもの・日本語以外の
// 名前(中国語・韓国語の漢字表記等)は空のまま残す。LLMはGemini→Groqの順(llmJudgeChain)。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/backfill-artist-name-readings.ts [--dry-run]
import { Type, type Schema } from '@google/genai'
import { createAdminClient } from '@/utils/Supabase/admin'
import { AllProvidersExhaustedError, generateJudgementText } from '@/utils/llmJudgeChain'

const DRY_RUN = process.argv.includes('--dry-run')
const BATCH = 30
const MIN_CONFIDENCE = 0.85
const KATAKANA_READING = /^[ァ-ヺー・\s]+$/

const SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      index: { type: Type.INTEGER },
      reading: { type: Type.STRING },
      isJapanese: { type: Type.BOOLEAN },
      confidence: { type: Type.NUMBER },
    },
    required: ['index', 'reading', 'isJapanese', 'confidence'],
  },
}

type Row = { id: string; name: string }

async function main() {
  const supabase = createAdminClient()
  const rows: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('artist')
      .select('id, name')
      .is('name_kana', null)
      .filter('sort_key', 'match', '^[一-龯々〆]')
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(`対象の取得に失敗しました: ${error.message}`)
    rows.push(...((data ?? []) as Row[]))
    if ((data ?? []).length < 1000) break
  }
  console.log(`読みなし・漢字の名前: ${rows.length}人${DRY_RUN ? '(確認のみ、保存しない)' : ''}`)

  let saved = 0
  let skipped = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const prompt = `以下は音楽アーティストの名前です。それぞれの読みをカタカナで答えてください。

ルール:
- 日本のアーティスト名なら、一般に知られている読みをカタカナで書く(例: 秋山黄色 → アキヤマキイロ、米津玄師 → ヨネヅケンシ)
- 姓と名の間などに空白は入れない
- 中国語・韓国語など日本語以外の名前の漢字表記なら isJapanese=false にし、readingは空文字にする
- 自分が確実に知っている読みだけ confidence を0.9以上にする。名前の読み方が何通りも考えられ確信が無い場合は confidence を0.5未満にする(誤った読みを入れるより空のままの方がよい)

${batch.map((r, j) => `[${j}] ${r.name}`).join('\n')}

全件について index を含めて配列で返してください。`
    let parsed: { index?: unknown; reading?: unknown; isJapanese?: unknown; confidence?: unknown }[] = []
    try {
      const out = JSON.parse(await generateJudgementText(prompt, SCHEMA))
      parsed = Array.isArray(out) ? out : []
    } catch (err) {
      if (err instanceof AllProvidersExhaustedError) {
        console.error(`LLMの無料枠が尽きたため止めます(${i}人目まで)。枠の回復後に再実行すると続きから処理します。`)
        break
      }
      console.error(`  判定に失敗しました: ${(err as Error).message}`)
      continue
    }
    for (const p of parsed) {
      const row = typeof p.index === 'number' ? batch[p.index] : undefined
      const reading = typeof p.reading === 'string' ? p.reading.replace(/\s+/g, '') : ''
      const confidence = typeof p.confidence === 'number' ? p.confidence : 0
      if (!row || p.isJapanese !== true || confidence < MIN_CONFIDENCE || !KATAKANA_READING.test(reading)) {
        skipped++
        continue
      }
      if (DRY_RUN) {
        console.log(`  ${row.name} → ${reading}(${confidence})`)
        saved++
        continue
      }
      const { error } = await supabase.from('artist').update({ name_kana: reading }).eq('id', row.id).is('name_kana', null)
      if (error) console.error(`  ${row.name}: 保存に失敗しました: ${error.message}`)
      else saved++
    }
    console.log(`  ${Math.min(i + BATCH, rows.length)}/${rows.length}(読みを付けた ${saved})`)
  }
  console.log(`完了: 読みを付けた ${saved}人 / 見送った ${skipped}人`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
