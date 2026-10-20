import BannerShell from './BannerShell'
import PlanetGlobePanel from './PlanetGlobePanel'
import type { PlanetData } from '@/utils/homeCardsMore'

const ACCENT = '#a27bff'

export default function MusicPlanetTourBanner({ data }: { data: PlanetData }) {
  return (
    <BannerShell
      index="04"
      titleLines={['Music Planet', 'Tour']}
      subtitle="アーティストの原点を探る"
      dateEyebrow="ARTIST ORIGIN"
      dateLabel={`${data.total.toLocaleString()}組の出身地`}
      eyebrow="WORLD MAP"
      eyebrowHref="/map"
      accent={ACCENT}
    >
      {data.artists.length === 0 ? (
        <p className="text-sm text-white/30">出身地が登録されたアーティストはまだいません。</p>
      ) : (
        <PlanetGlobePanel artists={data.artists} accent={ACCENT} />
      )}
    </BannerShell>
  )
}
