// scripts/fix-sync-work-titles.ts
/**
 * 反映済みのタイアップ作品(sync_work)と候補(sync_candidate)の作品名を、アニメ・ドラマ自身のタイトルに直す。
 * 記事名は原作のタイトルのことがあるため(例: 記事名「…挿れてもいいよ…」・アニメ版「…触れてもいいよ…」)。
 * 記事の基礎情報から取れなければ、いまのまま。何度実行しても安全(新しく集めた分にも使える)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/fix-sync-work-titles.ts [--dry-run]
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { chooseWorkTitle, fetchWikitexts } from '@/utils/wikipediaSync'

const DRY_RUN = process.argv.includes('--dry-run')

/** 記事名の末尾の曖昧さ回避((アニメ)・(漫画)など)を外す */
const stripDisambig = (t: string) => t.replace(/\s*[（(][^）)]*(?:アニメ|漫画|ドラマ|小説|ゲーム|映画|作品|テレビ)[^）)]*[）)]\s*$/, '').trim()

async function main() {
  const supabase = createAdminClient()
  const works: { id: string; title: string; source_key: string; work_type: string | null }[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data } = await supabase.from('sync_work').select('id, title, source_key, work_type').like('source_key', 'jawiki:%').range(offset, offset + 999)
    works.push(...(data ?? []))
    if ((data ?? []).length < 1000) break
  }
  console.log(`対象 ${works.length}作品${DRY_RUN ? '(dry-run)' : ''}`)

  let changed = 0
  for (let i = 0; i < works.length; i += 20) {
    const batch = works.slice(i, i + 20)
    const pages = await fetchWikitexts(batch.map((w) => w.source_key.replace(/^jawiki:/, '')))
    const byTitle = new Map(pages.map((p) => [p.title, p]))
    for (const w of batch) {
      const page = byTitle.get(w.source_key.replace(/^jawiki:/, ''))
      if (!page) continue
      const kind = w.work_type === 'drama' ? 'drama' : 'anime'
      const chosen = chooseWorkTitle(page.title, page.text, kind)
      // 記事名のままなら、曖昧さ回避((アニメ)など)だけ外した、いまの作品名と同じはず
      const real = chosen === page.title ? stripDisambig(page.title) : chosen
      if (!real || real === w.title) continue
      changed++
      console.log(`  ${w.title} → ${real}`)
      if (DRY_RUN) continue
      await supabase.from('sync_work').update({ title: real }).eq('id', w.id)
      await supabase.from('sync_candidate').update({ work_title: real }).eq('work_key', w.source_key)
    }
  }
  console.log(`\n${DRY_RUN ? '(dry-run) ' : ''}作品名を直したもの ${changed}件`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
