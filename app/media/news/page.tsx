import { fetchCachedNews } from '@/utils/newsCache'
import NewsFeedView from './NewsFeedView'

export default async function NewsStreamPage() {
  const { items, failedSources } = await fetchCachedNews()

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <NewsFeedView items={items} failedSources={failedSources} />
    </div>
  )
}
