import Link from 'next/link'
import BannerShell from './BannerShell'
import DynamicArtworkCarousel from './DynamicArtworkCarousel'
import { chunk, type UpcomingFestivalCard } from '@/utils/homeCards'

const ACCENT = '#4fd1a5'
const PAGE_SIZE = 5

function formatShortDate(dateStr: string) {
  const [, m, d] = dateStr.split('-')
  return `${Number(m)}/${Number(d)}`
}

function formatDateRange(start: string, end: string) {
  return start === end ? formatShortDate(start) : `${formatShortDate(start)} - ${formatShortDate(end)}`
}

export default function FesLiveFreakBanner({ festivals }: { festivals: UpcomingFestivalCard[] }) {
  const dateLabel =
    festivals.length > 0 ? `${formatShortDate(festivals[0].startDate)} 以降開催` : '近日開催情報を準備中'

  return (
    <BannerShell
      index="02"
      titleLines={['Fes &', 'Live Freak']}
      subtitle="国内外のフェス・イベント情報"
      dateEyebrow="THIS WEEK"
      dateLabel={dateLabel}
      eyebrow="FESTIVALS & EVENTS"
      eyebrowHref="/events"
      accent={ACCENT}
    >
      <DynamicArtworkCarousel
        emptyMessage="近日開催予定のフェス情報はまだ登録されていません。"
        pages={chunk(festivals, PAGE_SIZE).map((page, pageIndex) => (
          <div key={pageIndex} className="flex items-stretch overflow-x-auto pb-2 pl-1 pt-2">
            {page.map((f, i) => (
              <Link
                key={f.id}
                href={`/events/${f.id}`}
                className={`group relative block h-40 w-52 shrink-0 overflow-hidden rounded-lg transition-transform duration-200 hover:z-20 hover:-translate-y-2 sm:h-44 sm:w-60 ${
                  i > 0 ? '-ml-4 sm:-ml-6' : ''
                }`}
                style={{ zIndex: i }}
              >
                <div className="absolute inset-0 bg-white/5 ring-1 ring-white/10 transition group-hover:ring-white/40">
                  {f.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.imageUrl} alt={f.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-3xl">🎪</div>
                  )}
                </div>
                <div
                  className="absolute inset-x-0 bottom-0 p-3"
                  style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.15) 70%, transparent)' }}
                >
                  <p className="truncate text-sm font-semibold text-white">{f.name}</p>
                  <p className="mt-0.5 truncate text-[11px] font-medium" style={{ color: ACCENT }}>
                    {formatDateRange(f.startDate, f.endDate)}
                  </p>
                  {f.venue && <p className="truncate text-[11px] text-white/60">{f.venue}</p>}
                </div>
              </Link>
            ))}
          </div>
        ))}
      />
    </BannerShell>
  )
}
