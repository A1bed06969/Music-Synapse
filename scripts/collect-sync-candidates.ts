// scripts/collect-sync-candidates.ts
/**
 * 日本語Wikipediaのテレビアニメ・テレビドラマの作品ページから、主題歌・挿入歌などのタイアップ候補を集めて
 * sync_candidate に入れる(曲との紐付けは scripts/match-sync-candidates.ts)。
 *
 *  - 年ごとのカテゴリー(「◯年のテレビアニメ」「◯年のテレビドラマ」)の作品を順に読む
 *  - 同じ版(revision)を読み済みのページは飛ばすので、何度実行しても安全。途中で止まっても続きから再開できる
 *  - 主題歌の記述がある作品は、4作品ずつまとめて1回のLLM呼び出しにする(無料枠の節約)
 *  - LLMの無料枠が尽きたら、そこで止まる(終了コード75。枠の回復後に同じコマンドで続きから)
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/collect-sync-candidates.ts --kind=anime|drama --year=2025 [--limit=N] [--sample] [--dry-run]
 *   --sample: カテゴリーの先頭からではなく、ランダムにN件(品質の試し見用)
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { AllProvidersExhaustedError } from '@/utils/llmJudgeChain'
import { extractThemeText, extractTieUpsBatch, chooseWorkTitle, fetchCategoryTitles, fetchWikitexts, type ExtractedTieUp, type WorkKind } from '@/utils/wikipediaSync'

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
  const BATCH = 4

  async function save(page: { title: string; revisionId: number; text: string }, tieUps: ExtractedTieUp[], hadTheme: boolean) {
    pagesRead++
    candidates += tieUps.length
    console.log(`[${pagesRead}] ${page.title}: ${hadTheme ? tieUps.length + '件' : '主題歌の記述なし'}${tieUps.length ? ' → ' + tieUps.map((t) => `${t.role ?? '-'}「${t.song_title}」${t.artist_name ?? '?'}`).join(' / ').slice(0, 200) : ''}`)
    if (DRY_RUN) return
    const key = `jawiki:${page.title}`
    const sourceUrl = `https://ja.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`
    if (tieUps.length > 0) {
      const { error } = await supabase.from('sync_candidate').upsert(
        tieUps.map((t) => ({
          // 表示する作品名は、アニメ・ドラマ自身のタイトル(記事名が原作のタイトルのことがあるため)。取れなければ記事名
          work_key: key, work_title: chooseWorkTitle(page.title, page.text, KIND), work_type: KIND, year: YEAR,
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

  for (let i = 0; i < titles.length; i += 20) {
    const pages = await fetchWikitexts(titles.slice(i, i + 20))
    const pending: { page: (typeof pages)[number]; themeText: string }[] = []
    for (const page of pages) {
      if (!DRY_RUN && doneRev.get(`jawiki:${page.title}`) === page.revisionId) {
        pagesSkipped++
        continue
      }
      const themeText = extractThemeText(page.text)
      if (!themeText) {
        noTheme++
        await save(page, [], false)
      } else pending.push({ page, themeText })
    }
    for (let j = 0; j < pending.length; j += BATCH) {
      const group = pending.slice(j, j + BATCH)
      let results: ExtractedTieUp[][]
      try {
        results = await extractTieUpsBatch(group.map((g) => ({ title: g.page.title, kind: KIND, themeText: g.themeText })))
      } catch (err) {
        if (err instanceof AllProvidersExhaustedError) {
          console.log('\nLLMの無料枠が尽きたため止めます。枠の回復後に同じコマンドで続きから処理します。')
          console.log(`処理 ${pagesRead}作品 / 候補 ${candidates}件`)
          process.exit(75)
        }
        console.error(`  ${group.map((g) => g.page.title).join(' / ')}: 抽出に失敗(${(err as Error).message.slice(0, 80)})`)
        continue
      }
      for (const [k, g] of group.entries()) await save(g.page, results[k], true)
    }
  }
  console.log(`\n=== 完了${DRY_RUN ? '(dry-run)' : ''} === 読んだ ${pagesRead}作品 / 読み済みで飛ばした ${pagesSkipped} / 主題歌の記述なし ${noTheme} / 候補 ${candidates}件`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
