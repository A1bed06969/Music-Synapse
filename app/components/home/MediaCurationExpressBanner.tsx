import BannerShell from './BannerShell'
import CurationVisualCarousel from './CurationVisualCarousel'
import type { CurationCard } from '@/utils/homeCardsMore'

const ACCENT = '#ff5fb8'

export default function MediaCurationExpressBanner({ curations }: { curations: CurationCard[] }) {
  const total = curations.reduce((n, c) => n + c.entryCount, 0)
  return (
    <BannerShell
      index="06"
      titleLines={['Media Curation', 'Express']}
      subtitle="メディアが選んだ、今聴くべき音楽"
      dateEyebrow="MEDIA PICK"
      dateLabel={`${curations.length}企画・${total.toLocaleString()}件`}
      eyebrow="CURATIONS"
      eyebrowHref="/media/features"
      accent={ACCENT}
    >
      {curations.length === 0 ? (
        <p className="text-sm text-white/30">キュレーションはまだ登録されていません。</p>
      ) : (
        <CurationVisualCarousel curations={curations} accent={ACCENT} />
      )}
    </BannerShell>
  )
}
