// app/artists/[id]/media/page.tsx
import { createClient } from '@/utils/Supabase/server'
import { findRelatedNews, formatRelativeTime } from '@/utils/newsParser'
import { fetchCachedNews } from '@/utils/newsCache'

const MEDIA_LIMIT = 30

export default async function MediaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: artist }, { items }] = await Promise.all([
    supabase.from('artist').select('name, name_kana, name_en').eq('id', id).single(),
    fetchCachedNews(),
  ])

  const relatedNews = artist
    ? findRelatedNews(items, [artist.name, artist.name_kana, artist.name_en].filter((k): k is string => Boolean(k)), MEDIA_LIMIT)
    : []

  return (
    <div>
      <h2 className="text-xs uppercase tracking-wide text-white/40">Media</h2>
      {relatedNews.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">関連する記事は見つかりませんでした。</p>
      ) : (
        <ul className="mt-4 divide-y divide-white/5">
          {relatedNews.map((item) => (
            <li key={item.id} className="py-3">
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="group -m-1 flex gap-4 rounded-md p-1 hover:bg-white/5"
              >
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-white/5">
                  {item.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium group-hover:underline">{item.title}</p>
                  <p className="mt-1 text-xs text-white/40">
                    {item.source} · {formatRelativeTime(item.publishedAt)}
                  </p>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
