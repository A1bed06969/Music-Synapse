// scripts/backfill-sync-parts.ts
/**
 * 登録済みのタイアップ曲に、使われた「期・クール・劇場版」の区分(part_label)と、その区分の放送(公開)年月(air_year / air_month)を入れる。
 * 対象は、主題歌の節に「第N期・シーズン・クール・劇場版・映画・OVA・総集編」といった区分の手がかりがある作品だけ(区分の無い作品は何もしない)。
 * Wikipediaのページを読み直し、LLM(llmJudgeChain)で区分つきで抽出し、既存の候補(sync_candidate)と曲名で突き合わせて更新する。
 * 新しい曲は追加しない(区分の付与だけ)。LLMの無料枠が尽きたら終了コード75で止まり、同じコマンドで続きから再開できる。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/backfill-sync-parts.ts [--dry-run] [--limit=N]
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { AllProvidersExhaustedError } from '@/utils/llmJudgeChain'
import { fetchWikitexts, extractThemeText, extractTieUpsBatch, type ExtractedTieUp, type WorkKind } from '@/utils/wikipediaSync'
import { normTitle } from '@/utils/syncMatching'

const DRY_RUN = process.argv.includes('--dry-run')
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 0)
const PART_HINT = /第[0-9０-９一二三四五六七八九十]+期|シーズン|season|クール|劇場版|映画|OVA|総集編|ファイナル|Part\s*\d/i
const BATCH = 4

async function main() {
  const supabase = createAdminClient()
  const works: { id: string; source_key: string; work_type: string }[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('sync_work').select('id, source_key, work_type').not('source_key', 'is', null).range(from, from + 999)
    works.push(...((data ?? []) as typeof works))
    if ((data ?? []).length < 1000) break
  }
  // すでに区分が入っている作品は飛ばす
  const { data: doneRows } = await supabase.from('sync_candidate').select('work_key').not('part_label', 'is', null).limit(100000)
  const done = new Set((doneRows ?? []).map((r) => r.work_key as string))
  let targets = works.filter((w) => w.source_key.startsWith('jawiki:') && !done.has(w.source_key))
  console.log(`作品 ${works.length} / 区分つき済み ${done.size} / 確認対象 ${targets.length}`)

  const flagged: { work: (typeof works)[number]; page: { title: string; text: string }; themeText: string }[] = []
  for (let i = 0; i < targets.length; i += 20) {
    const chunk = targets.slice(i, i + 20)
    const pages = await fetchWikitexts(chunk.map((w) => w.source_key.slice('jawiki:'.length)))
    const byTitle = new Map(pages.map((p) => [p.title, p]))
    for (const w of chunk) {
      const page = byTitle.get(w.source_key.slice('jawiki:'.length))
      if (!page) continue
      const themeText = extractThemeText(page.text)
      if (themeText && PART_HINT.test(themeText)) flagged.push({ work: w, page, themeText })
    }
  }
  console.log(`区分の手がかりがある作品: ${flagged.length}`)
  if (DRY_RUN) return
  const queue = LIMIT ? flagged.slice(0, LIMIT) : flagged

  let updated = 0, worksDone = 0
  for (let j = 0; j < queue.length; j += BATCH) {
    const group = queue.slice(j, j + BATCH)
    let results: ExtractedTieUp[][]
    try {
      results = await extractTieUpsBatch(group.map((g) => ({ title: g.page.title, kind: g.work.work_type as WorkKind, themeText: g.themeText })))
    } catch (err) {
      if (err instanceof AllProvidersExhaustedError) {
        console.log(`\nLLMの無料枠が尽きたため止めます。更新 ${updated}件 / 作品 ${worksDone}`)
        process.exit(75)
      }
      console.error(`  抽出に失敗: ${group.map((g) => g.page.title).join(' / ')} (${(err as Error).message.slice(0, 80)})`)
      continue
    }
    for (const [k, g] of group.entries()) {
      const { data: cands } = await supabase.from('sync_candidate').select('id, song_title, applied_entry_id').eq('work_key', g.work.source_key)
      const byTitle = new Map<string, ExtractedTieUp>()
      for (const t of results[k]) if (t.part || t.air_year) byTitle.set(normTitle(t.song_title), t)
      let n = 0
      for (const c of cands ?? []) {
        const hit = byTitle.get(normTitle(c.song_title as string))
        if (!hit) continue
        const patch = { part_label: hit.part, air_year: hit.air_year, air_month: hit.air_month }
        await supabase.from('sync_candidate').update(patch).eq('id', c.id)
        if (c.applied_entry_id) await supabase.from('sync_entry').update(patch).eq('id', c.applied_entry_id)
        n++
      }
      updated += n
      worksDone++
      console.log(`[${worksDone}/${queue.length}] ${g.page.title}: ${n}/${(cands ?? []).length}件に区分を付与 ${[...new Set(results[k].map((t) => t.part).filter(Boolean))].join(' / ')}`)
    }
  }
  console.log(`\n=== 完了 === 更新 ${updated}件 / 作品 ${worksDone}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
