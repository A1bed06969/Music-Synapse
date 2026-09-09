import Link from 'next/link'
import CatalogSearchBox from '@/app/components/CatalogSearchBox'
import { createClient } from '@/utils/Supabase/server'
import { fetchUpcomingAlbums, fetchUpcomingFestivals, fetchMonthlyPowerPlayTop } from '@/utils/homeCards'
import { fetchNewArrivalsSummary } from '@/utils/newArrivals'
import { fetchCachedNews } from '@/utils/newsCache'
import DiscoverNewMusicBanner from '@/app/components/home/DiscoverNewMusicBanner'
import FesLiveFreakBanner from '@/app/components/home/FesLiveFreakBanner'
import MonthlyNextBreakBanner from '@/app/components/home/MonthlyNextBreakBanner'
import NewArrivalsBanner from '@/app/components/home/NewArrivalsBanner'
import HeroBackgroundVideo from '@/app/components/home/HeroBackgroundVideo'
import LatestNewsList, { NEWS_PREVIEW_COUNT } from '@/app/components/home/LatestNews'

const UPCOMING_ALBUM_COUNT = 18
const UPCOMING_FESTIVAL_COUNT = 15
const POWER_PLAY_TOP_COUNT = 5

function currentMonthLabel() {
  const [y, m] = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7).split('-')
  return `${y}年${Number(m)}月`
}

export default async function Home() {
  const supabase = await createClient()
  const [albums, festivals, powerPlay, newArrivals, { items: newsItems }] = await Promise.all([
    fetchUpcomingAlbums(supabase, UPCOMING_ALBUM_COUNT),
    fetchUpcomingFestivals(supabase, UPCOMING_FESTIVAL_COUNT),
    fetchMonthlyPowerPlayTop(supabase, POWER_PLAY_TOP_COUNT),
    fetchNewArrivalsSummary(supabase),
    // news_itemはVercel CronならぬGitHub Actionsが定期取得済みのキャッシュを読むだけ
    // (utils/newsCache.ts)なので、以前のRSS直取得(失敗時タイムアウト待ちで
    // 最大3.9秒)と違い、他のカードと並行取得して問題ない速さ(実測0.2〜0.5秒)。
    fetchCachedNews(),
  ])
  const latestNews = newsItems.slice(0, NEWS_PREVIEW_COUNT)

  return (
    <div className="py-12">
      <HeroBackgroundVideo />
      <div className="mx-auto max-w-[1600px] px-6">
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

        <section className="mt-8">
          <NewArrivalsBanner summary={newArrivals} />
        </section>

        <section className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <DiscoverNewMusicBanner albums={albums} />
          <FesLiveFreakBanner festivals={festivals} />
          <MonthlyNextBreakBanner top={powerPlay.top} monthLabel={currentMonthLabel()} />
        </section>

        <section className="mt-14">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">音楽ニュース</h2>
            <Link href="/media/news" className="text-xs text-white/40 hover:text-white/70">
              ニュースストリームで全部見る →
            </Link>
          </div>

          <LatestNewsList items={latestNews} />
        </section>
      </div>
    </div>
  )
}
