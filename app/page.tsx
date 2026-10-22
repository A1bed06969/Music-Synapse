import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { fetchUpcomingAlbums, fetchUpcomingFestivals, fetchMonthlyPowerPlayTop } from '@/utils/homeCards'
import { fetchNewArrivalsSummary } from '@/utils/newArrivals'
import { fetchCachedNews } from '@/utils/newsCache'
import DiscoverNewMusicBanner from '@/app/components/home/DiscoverNewMusicBanner'
import FesLiveFreakBanner from '@/app/components/home/FesLiveFreakBanner'
import MonthlyNextBreakBanner from '@/app/components/home/MonthlyNextBreakBanner'
import NewArrivalsBanner from '@/app/components/home/NewArrivalsBanner'
import MusicPlanetTourBanner from '@/app/components/home/MusicPlanetTourBanner'
import ClipDiscGuideBanner from '@/app/components/home/ClipDiscGuideBanner'
import MediaCurationExpressBanner from '@/app/components/home/MediaCurationExpressBanner'
import CrownTheWinnersBanner from '@/app/components/home/CrownTheWinnersBanner'
import GenreRootsTapestryBanner from '@/app/components/home/GenreRootsTapestryBanner'
import ConnectTheMusicMakersBanner from '@/app/components/home/ConnectTheMusicMakersBanner'
import { fetchCrownWinners, fetchGenreRoots, fetchConnectPairs } from '@/utils/homeCardsCrown'
import { fetchCurations, fetchDiscGuideBooks, fetchPlanetArtists, fetchTieUpYears } from '@/utils/homeCardsMore'
import TieUpTimeMachineBanner from '@/app/components/home/TieUpTimeMachineBanner'
import SamplingMashUpAnatomyBanner from '@/app/components/home/SamplingMashUpAnatomyBanner'
import ArtWorkMuseumBanner from '@/app/components/home/ArtWorkMuseumBanner'
import HeroBackgroundVideo from '@/app/components/home/HeroBackgroundVideo'
import LatestNewsList, { NEWS_PREVIEW_COUNT } from '@/app/components/home/LatestNews'

const UPCOMING_ALBUM_COUNT = 18
const UPCOMING_FESTIVAL_COUNT = 15
const POWER_PLAY_TOP_COUNT = 5
// 全企画を出す(バナーの「◯企画・◯件」は、ここに並ぶ企画の合計なので、絞ると実際より少なく出る)
const CURATION_COUNT = 30

/** 連載の章の見出し(NEW / DIG / ARCHIVE / EXPLORE) */
function ChapterLabel({ title, caption, className = '' }: { title: string; caption: string; className?: string }) {
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <span className="text-xs font-black tracking-[0.3em] text-white/70">{title}</span>
      <span className="h-px flex-1 bg-gradient-to-r from-white/20 to-transparent" />
      <span className="text-xs text-white/40">{caption}</span>
    </div>
  )
}

function currentMonthLabel() {
  const [y, m] = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7).split('-')
  return `${y}年${Number(m)}月`
}

export default async function Home() {
  const supabase = await createClient()
  const [albums, festivals, powerPlay, newArrivals, { items: newsItems }, planet, discGuide, curations, crown, genreRoots, connect, tieUps] = await Promise.all([
    fetchUpcomingAlbums(supabase, UPCOMING_ALBUM_COUNT),
    fetchUpcomingFestivals(supabase, UPCOMING_FESTIVAL_COUNT),
    fetchMonthlyPowerPlayTop(supabase, POWER_PLAY_TOP_COUNT),
    fetchNewArrivalsSummary(supabase),
    // news_itemはGitHub Actionsが定期取得済みのキャッシュを読むだけ(utils/newsCache.ts)
    // なので、以前のRSS直取得(失敗時タイムアウト待ちで最大3.9秒)と違い、
    // 他のカードと並行取得して問題ない速さ(実測0.2〜0.5秒)。
    fetchCachedNews(),
    fetchPlanetArtists(supabase),
    fetchDiscGuideBooks(supabase),
    fetchCurations(supabase, CURATION_COUNT),
    fetchCrownWinners(supabase),
    fetchGenreRoots(supabase),
    fetchConnectPairs(supabase),
    fetchTieUpYears(supabase),
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
              className="mx-auto h-24 w-auto object-contain sm:h-44 lg:h-52"
            />
          </h1>
          <p className="mt-2 text-sm text-white/55 sm:text-base">音楽をつなぎ、新しい発見へ。</p>
        </section>

        <section className="mt-8">
          <NewArrivalsBanner summary={newArrivals} />
        </section>

        {/* 連載は、3列×4行(章ごとに3つ): NEW(01-03) / DIG(04-06) / ARCHIVE(07-09) / EXPLORE(10-12) */}
        <ChapterLabel title="NEW" caption="新しい音楽に出会う" className="mt-14" />
        <section className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <DiscoverNewMusicBanner albums={albums} />
          <FesLiveFreakBanner festivals={festivals} />
          <MonthlyNextBreakBanner top={powerPlay.top} monthLabel={currentMonthLabel()} />
        </section>

        <ChapterLabel title="DIG" caption="掘り下げる" className="mt-12" />
        <section className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <MusicPlanetTourBanner data={planet} />
          <ClipDiscGuideBanner books={discGuide} />
          <MediaCurationExpressBanner curations={curations} />
        </section>

        <ChapterLabel title="ARCHIVE" caption="歴史をたどる" className="mt-12" />
        <section className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <CrownTheWinnersBanner data={crown} />
          <GenreRootsTapestryBanner data={genreRoots} />
          <ConnectTheMusicMakersBanner data={connect} />
        </section>

        <ChapterLabel title="EXPLORE" caption="たどって、解く" className="mt-12" />
        <section className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <TieUpTimeMachineBanner years={tieUps} />
          <SamplingMashUpAnatomyBanner />
          <ArtWorkMuseumBanner />
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
