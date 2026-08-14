import { NEWS_SOURCES } from '@/utils/newsFeeds'
import { fetchAllNews } from '@/utils/newsParser'
import NewsFeedView from './NewsFeedView'

export default async function NewsStreamPage() {
  const { items, failedSources } = await fetchAllNews(NEWS_SOURCES)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <NewsFeedView items={items} failedSources={failedSources} />
    </div>
  )
}
