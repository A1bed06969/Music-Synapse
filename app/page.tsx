import Link from 'next/link'
import { NEWS_SOURCES } from '@/utils/newsFeeds'
import { fetchAllNews, formatRelativeTime } from '@/utils/newsParser'
import CatalogSearchBox from '@/app/components/CatalogSearchBox'

const HUB_CARDS: { title: string; subtitle: string; href: string }[] = [
  { title: 'Discover New Music', subtitle: '新譜ピックアップ・リリースカレンダー', href: '/albums/calendar' },
  { title: 'Fes & Live Freak', subtitle: '国内外のフェス・イベント情報', href: '/events' },
  { title: 'Monthly Next Break', subtitle: '今月のパワープレイ集計ランキング', href: '#' },
]

const NEWS_PREVIEW_COUNT = 8

export default async function Home() {
  const { items: newsItems } = await fetchAllNews(NEWS_SOURCES)
  const latestNews = newsItems.slice(0, NEWS_PREVIEW_COUNT)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <section className="text-center">
        <h1>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-full.png"
            alt="Music Synapse"
            className="mx-auto h-24 w-auto object-contain sm:h-32"
          />
        </h1>
        <p className="mt-2 text-sm text-white/50">音楽をつなぎ、新しい発見へ。</p>

        <div className="mx-auto mt-8 max-w-xl">
          <CatalogSearchBox variant="overlay" />
        </div>
      </section>

      <section className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {HUB_CARDS.map((card) => (
          <Link
            key={card.title}
            href={card.href}
            className="group flex flex-col justify-center rounded-lg border border-white/10 px-6 py-8 text-center transition hover:border-white/25 hover:bg-white/[0.03]"
          >
            <h2 className="text-lg font-bold tracking-tight">{card.title}</h2>
            <p className="mt-2 text-xs text-white/50">{card.subtitle}</p>
          </Link>
        ))}
      </section>

      <section className="mt-14">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">音楽ニュース</h2>
          <Link href="/media/news" className="text-xs text-white/40 hover:text-white/70">
            ニュースストリームで全部見る →
          </Link>
        </div>

        {latestNews.length === 0 ? (
          <p className="mt-6 text-sm text-white/40">現在ニュースを取得できませんでした。</p>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {latestNews.map((item) => (
              <a
                key={item.id}
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="group block"
              >
                <div className="aspect-video overflow-hidden rounded-md bg-white/5">
                  {item.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnailUrl}
                      alt={item.title}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-white/20">
                      No Image
                    </div>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-medium group-hover:opacity-70">{item.title}</p>
                <p className="mt-0.5 text-xs text-white/30">
                  {item.source} · {formatRelativeTime(item.publishedAt)}
                </p>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
