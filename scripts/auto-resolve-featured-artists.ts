// scripts/auto-resolve-featured-artists.ts
//
// feat.抽出で自動作成されたアーティスト(featured_artist_review)のうち、まだ
// 人がレビューしていない(confirmed=false, rejected=false)ものに対して、
// Apple Musicのカタログ照合による自動裏取り(autoResolveFeaturedArtist)を
// 一括で試みる。解決できたものはconfirmedになり、レビュー画面から自動的に
// 消える。解決できなかったものはそのまま残り、引き続き人のレビューが必要。
//
// 半自動化(2026-09-22、ユーザー要望): feat.アーティストの登録が進むにつれ
// レビュー待ちが数千件規模になり、全件を人が確認するのは非現実的になった。
// 一方で、Apple Music側のカタログ照合(元曲が候補自身の作品一覧に載っているか)で
// 裏取りできたものは、人が目視確認するのと同程度の確度があると判断できるため、
// それが成功した分だけ自動確定してレビュー負荷を減らす。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/auto-resolve-featured-artists.ts [--limit=N]
import { createAdminClient } from '@/utils/Supabase/admin'
import { autoResolveFeaturedArtist } from '@/app/admin/data/artists/featured-review/actions'

const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : undefined

/** PostgRESTは既定で1件のリクエストにつき1000件で打ち切るため、.limit()に
 * 1000を超える値を渡しても無視される(2026-09-22、実際にこれで8000件超の
 * うち先頭1000件しか処理されていなかったことが発覚)。range()でページングして
 * 全件取得する。--limitはページング後の先頭N件に絞るためだけに使う。 */
async function fetchPendingReviews(supabase: ReturnType<typeof createAdminClient>) {
  const rows: { id: string; extracted_name: string }[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('featured_artist_review')
      .select('id, extracted_name')
      .eq('confirmed', false)
      .eq('rejected', false)
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1)
    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }
  return rows
}

async function main() {
  const supabase = createAdminClient()

  const allRows = await fetchPendingReviews(supabase)
  const rows = LIMIT ? allRows.slice(0, LIMIT) : allRows

  console.log(`対象(未レビュー、全${allRows.length}件中${rows.length}件を処理): \n`)

  let autoConfirmed = 0
  let stillPending = 0

  for (const [index, row] of (rows ?? []).entries()) {
    try {
      const { autoConfirmed: confirmed } = await autoResolveFeaturedArtist(row.id)
      if (confirmed) {
        autoConfirmed++
        console.log(`[${index + 1}/${rows?.length}] ✅ ${row.extracted_name}: 自動確定`)
      } else {
        stillPending++
      }
    } catch (err) {
      stillPending++
      console.error(`[${index + 1}/${rows?.length}] ❌ ${row.extracted_name}: ${(err as Error).message}`)
    }
  }

  console.log(`\n完了: 自動確定${autoConfirmed}件、引き続きレビュー待ち${stillPending}件`)
}

main()
