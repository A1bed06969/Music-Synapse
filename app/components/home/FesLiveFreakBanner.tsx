import BannerShell from './BannerShell'
import FestivalFocusCarousel from './FestivalFocusCarousel'
import type { UpcomingFestivalCard } from '@/utils/homeCards'

const ACCENT = '#4fd1a5'

function formatShortDate(dateStr: string) {
  const [, m, d] = dateStr.split('-')
  return `${Number(m)}/${Number(d)}`
}

export default function FesLiveFreakBanner({ festivals }: { festivals: UpcomingFestivalCard[] }) {
  const dateLabel =
    festivals.length > 0 ? `${formatShortDate(festivals[0].startDate)} 以降開催` : '近日開催情報を準備中'

  return (
    <BannerShell
      index="02"
      titleLines={['Fes & Live', 'Freak']}
      subtitle="国内外のフェス・イベント情報"
      dateEyebrow="THIS WEEK"
      dateLabel={dateLabel}
      eyebrow="FESTIVALS & EVENTS"
      eyebrowHref="/events"
      accent={ACCENT}
    >
      {festivals.length === 0 ? (
        <p className="text-sm text-white/30">近日開催予定のフェス情報はまだ登録されていません。</p>
      ) : (
        <FestivalFocusCarousel festivals={festivals} accent={ACCENT} />
      )}
    </BannerShell>
  )
}
