import Link from 'next/link'
import BannerShell from './BannerShell'
import type { UpcomingFestivalCard } from '@/utils/homeCards'

const ACCENT = '#4fd1a5'

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
      {festivals.length === 0 ? (
        <p className="text-sm text-white/30">近日開催予定のフェス情報はまだ登録されていません。</p>
      ) : (
        // ページ送り(ドット)方式だと続きへの横スワイプが「次のセットへジャンプ」と
        // 衝突して操作しづらかったため、1本の長い横スクロールに統一する。
        <div className="overflow-x-auto pb-1 pl-1 pt-2">
          <div style={{ width: 'max-content' }}>
            <div className="flex items-stretch">
              {festivals.map((f, i) => (
                <Link
                  key={f.id}
                  href={`/events/${f.id}`}
                  className={`group relative block h-36 w-52 shrink-0 overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/10 transition-transform duration-200 hover:z-20 hover:-translate-y-2 hover:ring-white/40 sm:h-40 sm:w-60 ${
                    i > 0 ? '-ml-4 sm:-ml-6' : ''
                  }`}
                  style={{ zIndex: i }}
                >
                  {f.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.imageUrl} alt={f.name} className="h-full w-full object-contain" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-3xl">🎪</div>
                  )}
                </Link>
              ))}
            </div>
            <div className="mt-3 flex gap-4">
              {festivals.map((f) => (
                <Link key={f.id} href={`/events/${f.id}`} className="group block w-52 shrink-0 sm:w-60">
                  <p className="truncate text-sm font-semibold text-white group-hover:opacity-80">{f.name}</p>
                  <p className="mt-0.5 truncate text-[11px] font-medium" style={{ color: ACCENT }}>
                    {formatDateRange(f.startDate, f.endDate)}
                  </p>
                  {f.venue && <p className="truncate text-[11px] text-white/50">{f.venue}</p>}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </BannerShell>
  )
}
