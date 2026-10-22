// scripts/backfill-sync-work-season.ts
/**
 * タイアップ作品(sync_work)に、放送の「冬・春・夏・秋・継続」(season_label)と、オリジナル作品か(is_original)を入れる。
 * Wikipediaの基礎情報(放送開始・放送期間・原作)から決める。LLMは使わず、Wikipediaへの読み取りだけ(1回20件)。
 * 読めなかった作品は season_label を空のまま残す(表示は「その他」)。何度実行しても安全。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/backfill-sync-work-season.ts [--all]   (--all は決まっている作品も取り直す)
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchWikitexts, extractBroadcastSeason, isOriginalWork } from '@/utils/wikipediaSync'

async function main() {
  const all = process.argv.includes('--all')
  const supabase = createAdminClient()
  const works: { id: string; source_key: string; year: number | null; season_label: string | null; is_original: boolean }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('sync_work').select('id, source_key, year, season_label, is_original').not('source_key', 'is', null).not('year', 'is', null).range(from, from + 999)
    if (error) throw new Error(error.message)
    works.push(...(data ?? []))
    if ((data ?? []).length < 1000) break
  }
  const targets = works.filter((w) => w.source_key.startsWith('jawiki:') && (all || !w.season_label))
  console.log(`対象 ${targets.length} / 全 ${works.length}`)
  const tally: Record<string, number> = {}
  let original = 0
  for (let i = 0; i < targets.length; i += 20) {
    const chunk = targets.slice(i, i + 20)
    const pages = await fetchWikitexts(chunk.map((w) => w.source_key.slice('jawiki:'.length)))
    const byTitle = new Map(pages.map((p) => [p.title, p]))
    for (const w of chunk) {
      const page = byTitle.get(w.source_key.slice('jawiki:'.length))
      if (!page) { tally['ページ取得なし'] = (tally['ページ取得なし'] ?? 0) + 1; continue }
      const season = extractBroadcastSeason(page.text, w.year!)
      const isOriginal = isOriginalWork(page.text)
      tally[season ?? '不明'] = (tally[season ?? '不明'] ?? 0) + 1
      if (isOriginal) original++
      const { error } = await supabase.from('sync_work').update({ season_label: season, is_original: isOriginal }).eq('id', w.id)
      if (error) console.error(`更新失敗 ${w.id}: ${error.message}`)
    }
    if ((i / 20) % 10 === 0) console.log(`${Math.min(i + 20, targets.length)}/${targets.length}`)
  }
  console.log(JSON.stringify(tally), `オリジナル ${original}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
