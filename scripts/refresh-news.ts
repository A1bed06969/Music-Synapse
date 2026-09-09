// scripts/refresh-news.ts
//
// 9媒体のRSSを取得し、news_itemテーブルへ書き込む。トップページ・/media/news・
// アーティスト/イベント詳細ページの関連ニュースは、この処理をリクエストのたびに
// 行っていたため、失敗する媒体があるとタイムアウトまで待たされ、トップページで
// 実測3.9秒かかっていた(utils/newsCache.tsが読むだけの版)。
//
// Vercel(Hobby)のCron Jobsは1日1回までしか使えないため、
// .github/workflows/refresh-news.ymlからGitHub Actionsで30分おきに実行する
// (このリポジトリの他のバッチ処理と同じ、service_roleキーで直接Supabaseを
// 叩く方式)。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/refresh-news.ts
import { NEWS_SOURCES } from '../utils/newsFeeds'
import { fetchAllNews, type NewsItem } from '../utils/newsParser'
import { createAdminClient } from '../utils/Supabase/admin'

async function main() {
  const { items, failedSources } = await fetchAllNews(NEWS_SOURCES)
  const supabase = createAdminClient()

  // 同一フィード内でguid/linkが重複するケースがある(例: Qetic)。
  // 1回のupsert文で同じidを2回更新しようとするとPostgresがエラーになるため、
  // 先にidで重複排除する(後勝ち=より新しい記事の情報を残す)。
  const itemsBySource = new Map<string, NewsItem[]>()
  for (const item of items) {
    const list = itemsBySource.get(item.source) ?? []
    const dupeIndex = list.findIndex((existing) => existing.id === item.id)
    if (dupeIndex !== -1) list[dupeIndex] = item
    else list.push(item)
    itemsBySource.set(item.source, list)
  }

  let upserted = 0
  let deleted = 0

  for (const [source, sourceItems] of itemsBySource) {
    const { error: upsertError } = await supabase.from('news_item').upsert(
      sourceItems.map((item) => ({
        id: item.id,
        source: item.source,
        title: item.title,
        link: item.link,
        thumbnail_url: item.thumbnailUrl,
        published_at: item.publishedAt,
        author: item.author,
        category: item.category,
        fetched_at: new Date().toISOString(),
      })),
      { onConflict: 'id' }
    )
    if (upsertError) {
      console.error(`${source}: upsertに失敗しました: ${upsertError.message}`)
      continue
    }
    upserted += sourceItems.length

    // この媒体の今回の取得結果に無くなった記事(古くなって上位N件から
    // 外れたもの)を削除する。取得に失敗した媒体はここに来ないため、
    // 前回までの取得結果がそのまま残る(取得失敗のたびに表示が消えるのを防ぐ)。
    const currentIds = new Set(sourceItems.map((item) => item.id))
    const { data: existingRows, error: selectError } = await supabase
      .from('news_item')
      .select('id')
      .eq('source', source)
    if (selectError) {
      console.error(`${source}: 既存行の取得に失敗しました: ${selectError.message}`)
      continue
    }
    const idsToDelete = (existingRows ?? []).map((r) => r.id).filter((id) => !currentIds.has(id))
    if (idsToDelete.length > 0) {
      const { error: deleteError } = await supabase.from('news_item').delete().in('id', idsToDelete)
      if (deleteError) {
        console.error(`${source}: 古い記事の削除に失敗しました: ${deleteError.message}`)
        continue
      }
      deleted += idsToDelete.length
    }
  }

  console.log(`完了: ${upserted}件を保存、${deleted}件の古い記事を削除`)
  if (failedSources.length > 0) {
    console.log(`取得できなかった媒体: ${failedSources.join('、')}`)
  }
}

main()
