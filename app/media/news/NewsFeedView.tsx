'use client'

import { useMemo, useState } from 'react'
import { NEWS_SOURCES } from '@/utils/newsFeeds'
import { NEWS_CATEGORY_LABEL, formatRelativeTime, type NewsCategory, type NewsItem } from '@/utils/newsParser'

const CATEGORY_FILTERS: { value: NewsCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'release', label: NEWS_CATEGORY_LABEL.release },
  { value: 'live', label: NEWS_CATEGORY_LABEL.live },
  { value: 'interview', label: NEWS_CATEGORY_LABEL.interview },
  { value: 'other', label: NEWS_CATEGORY_LABEL.other },
]

function todayLabel(): string {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日のニュース`
}

export default function NewsFeedView({ items, failedSources }: { items: NewsItem[]; failedSources: string[] }) {
  const [category, setCategory] = useState<NewsCategory | 'all'>('all')

  const filtered = useMemo(
    () => (category === 'all' ? items : items.filter((i) => i.category === category)),
    [items, category]
  )

  const bySource = useMemo(() => {
    const map = new Map<string, NewsItem[]>()
    for (const item of filtered) {
      const list = map.get(item.source) ?? []
      list.push(item)
      map.set(item.source, list)
    }
    // NEWS_SOURCESの登録順で並べ、記事が1件も無いメディアは表示しない
    return NEWS_SOURCES.map((s) => ({ name: s.name, items: map.get(s.name) ?? [] })).filter(
      (g) => g.items.length > 0
    )
  }, [filtered])

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">{todayLabel()}</h1>
      <p className="mt-2 text-sm text-white/50">音楽メディア各社の最新記事をまとめてチェックできます。</p>

      {failedSources.length > 0 && (
        <p className="mt-2 text-xs text-white/30">取得できなかったメディア: {failedSources.join('、')}</p>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {CATEGORY_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setCategory(f.value)}
            className={`rounded-full border px-4 py-1.5 text-sm transition ${
              category === f.value
                ? 'border-white bg-white text-black'
                : 'border-white/15 text-white/60 hover:border-white/30 hover:text-white'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {bySource.length === 0 ? (
        <p className="mt-12 text-sm text-white/40">該当するニュースが見つかりませんでした。</p>
      ) : (
        <div className="mt-10 space-y-12">
          {bySource.map((group) => (
            <section key={group.name}>
              <div className="flex items-baseline gap-2">
                <h2 className="text-lg font-semibold">{group.name}</h2>
                <span className="text-xs text-white/40">{group.items.length}件</span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {group.items.map((item) => (
                  <a
                    key={item.id}
                    href={item.link}
                    target="_blank"
                    rel="noreferrer"
                    className="group block overflow-hidden rounded-lg border border-white/10 bg-white/[0.03] transition duration-200 hover:-translate-y-0.5 hover:border-white/30 hover:shadow-lg hover:shadow-black/30"
                  >
                    <div className="aspect-video overflow-hidden bg-white/5">
                      {item.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.thumbnailUrl}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-white/20">
                          No Image
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="line-clamp-2 text-sm font-medium leading-snug">{item.title}</p>
                      <div className="mt-2 flex items-center justify-between text-xs text-white/40">
                        <span>{formatRelativeTime(item.publishedAt)}</span>
                        {item.author && <span className="truncate pl-2">{item.author}</span>}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
