// scripts/collect-sync-candidates.ts
/**
 * 日本語Wikipediaのテレビアニメ・テレビドラマの作品ページから、主題歌・挿入歌などのタイアップ候補を集めて
 * sync_candidate に入れる(曲との紐付けは scripts/match-sync-candidates.ts)。
 *
 *  - 年ごとのカテゴリー(「◯年のテレビアニメ」「◯年のテレビドラマ」)の作品を順に読む
 *  - 同じ版(revision)を読み済みのページは飛ばすので、何度実行しても安全。途中で止まっても続きから再開できる
 *  - LLMの無料枠が尽きたら、そこで止まる(枠の回復後に同じコマンドで続きから)
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/collect-sync-candidates.ts --kind=anime|drama --year=2025 [--limit=N] [--sample] [--dry-run]
 *   --sample: カテゴリーの先頭からではなく、ランダムにN件(品質の試し見用)
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { AllProvidersExhaustedError } from '@/utils/llmJudgeChain'
import { extractThemeText, extractTieUps, fetchCategoryTitles, fetchWikitexts, type WorkKind } from '@/utils/wikipediaSync'

const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').split('=')[1]
const KIND = arg('kind') as WorkKind
const YEAR = Number(arg('year'))
const LIMIT = arg('limit') ? Number(arg('limit')) : undefined
const DRY_RUN = process.argv.includes('--dry-run')
const SAMPLE = process.argv.includes('--sample')

async function main() {
  if ((KIND !== 'anime' && KIND !== 'drama') || !YEAR) {
    console.error('使い方: npx tsx --env-file=.env.local scripts/collect-sync-candidates.ts --kind=anime|drama --year=2025 [--limit=N] [--sample] [--dry-run]')
    process.exit(1)
  }
  const supabase = createAdminClient()

  let titles = await fetchCategoryTitles(KIND, YEAR)
  console.log(`${YEAR}年の${KIND === 'anime' ? 'テレビアニメ' : 'テレビドラマ'}: ${titles.length}作品`)
  if (SAMPLE) titles = [...titles].sort(() => Math.random() - 0.5)
  if (LIMIT) titles = titles.slice(0, LIMIT)

  const { data: done } = await supabase.from('sync_source_page').select('source_key, revision_id').in('source_key', titles.map((t) => `jawiki:${t}`))
  const doneRev = new Map((done ?? []).map((r) => [r.source_key as string, Number(r.revision_id)]))

  let pagesRead = 0, pagesSkipped = 0, noTheme = 0, candidates = 0
  for (let i = 0; i < titles.length; i += 20) {
    const pages = await fetchWikitexts(titles.slice(i, i + 20))
    for (const page of pages) {
      const key = `jawiki:${page.title}`
      if (!DRY_RUN && doneRev.get(key) === page.revisionId) {
        pagesSkipped++
        continue
      }
      const themeText = extractThemeText(page.text)
      let tieUps: Awaited<ReturnType<typeof extractTieUps>> = []
      if (themeText) {
        try {
          tieUps = await extractTieUps(page.title, KIND, themeText)
        } catch (err) {
          if (err instanceof AllProvidersExhaustedError) {
            console.log('\nLLMの無料枠が尽きたため止めます。枠の回復後に同じコマンドで続きから処理します。')
            console.log(`処理 ${pagesRead}作品 / 候補 ${candidates}件`)
            return
          }
          console.error(`  ${page.title}: 抽出に失敗(${(err as Error).message.slice(0, 80)})`)
          continue
        }
      } else {
        noTheme++
      }
      pagesRead++
      candidates += tieUps.length
      console.log(`[${pagesRead}] ${page.title}: ${themeText ? tieUps.length + '件' : '主題歌の記述なし'}${tieUps.length ? ' → ' + tieUps.map((t) => `${t.role ?? '-'}「${t.song_title}」${t.artist_name ?? '?'}`).join(' / ').slice(0, 220) : ''}`)
      if (DRY_RUN) continue

      const sourceUrl = `https://ja.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`
      if (tieUps.length > 0) {
        const { error } = await supabase.from('sync_candidate').upsert(
          tieUps.map((t) => ({
            work_key: key, work_title: page.title, work_type: KIND, year: YEAR,
            role: t.role ?? '', song_title: t.song_title, artist_name: t.artist_name ?? '', note: t.note, source_url: sourceUrl,
          })),
          { onConflict: 'work_key,role,song_title,artist_name', ignoreDuplicates: true }
        )
        if (error) console.error(`  ${page.title}: 候補の保存に失敗: ${error.message}`)
      }
      await supabase.from('sync_source_page').upsert({
        source_key: key, title: page.title, work_type: KIND, year: YEAR, revision_id: page.revisionId, candidate_count: tieUps.length, fetched_at: new Date().toISOString(),
      })
    }
  }
  console.log(`\n=== 完了${DRY_RUN ? '(dry-run)' : ''} === 読んだ ${pagesRead}作品 / 読み済みで飛ばした ${pagesSkipped} / 主題歌の記述なし ${noTheme} / 候補 ${candidates}件`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
