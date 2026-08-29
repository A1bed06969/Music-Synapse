import Link from 'next/link'
import BannerShell from './BannerShell'
import JapanPowerPlayMap from './JapanPowerPlayMap'
import type { PowerPlayTopEntry } from '@/utils/homeCards'
import type { PrefectureMapData } from '@/app/components/PrefectureMap'

const ACCENT = '#f0975a'

export default function MonthlyNextBreakBanner({
  top,
  prefectureData,
  monthLabel,
}: {
  top: PowerPlayTopEntry[]
  prefectureData: PrefectureMapData[]
  monthLabel: string
}) {
  const [first, ...rest] = top

  return (
    <BannerShell
      index="03"
      titleLines={['Monthly', 'Next Break']}
      subtitle="今月のパワープレイ集計ランキング"
      dateEyebrow="POWER PLAY RANKING"
      dateLabel={monthLabel}
      eyebrow="RANKING & MAP"
      eyebrowHref="/media/on-air"
      accent={ACCENT}
    >
      {top.length === 0 ? (
        <p className="text-sm text-white/30">{monthLabel}のパワープレイ実績はまだありません。</p>
      ) : (
        <div className="relative grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {/* 背景要素としての日本地図。主役はランキングなので絶対配置+低い不透明度で右側全体に薄く敷く */}
          <div className="pointer-events-none absolute inset-0 hidden opacity-70 lg:block">
            <div className="ml-[45%] h-full w-[55%]">
              <JapanPowerPlayMap data={prefectureData} accent={ACCENT} />
            </div>
          </div>

          <div className="relative z-10 flex flex-col gap-5 sm:flex-row">
            {first && (
              <Link
                href={first.href || (first.artistId ? `/artists/${first.artistId}` : '#')}
                className="group block w-full shrink-0 sm:w-44"
              >
                <div className="aspect-square overflow-hidden rounded-xl bg-white/5 shadow-xl shadow-black/50 ring-1 ring-white/10 transition group-hover:ring-white/30">
                  {first.artistImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={first.artistImageUrl}
                      alt={first.label}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-3xl">🏆</div>
                  )}
                </div>
                <p className="mt-2.5 text-[11px] font-bold tracking-wide" style={{ color: ACCENT }}>
                  POWER PLAY No.1
                </p>
                <p className="truncate text-base font-semibold text-white group-hover:opacity-80">
                  {first.sub ?? first.label}
                </p>
                {first.sub && <p className="truncate text-xs text-white/40">{first.label}</p>}
              </Link>
            )}

            {rest.length > 0 && (
              <ul className="flex-1 space-y-3 sm:pt-1">
                {rest.map((r, i) => (
                  <li key={r.key}>
                    <Link
                      href={r.href || (r.artistId ? `/artists/${r.artistId}` : '#')}
                      className="group flex items-center gap-3"
                    >
                      <span className="w-5 shrink-0 text-right text-sm font-bold text-white/25">
                        {String(i + 2).padStart(2, '0')}
                      </span>
                      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-white/5 ring-1 ring-white/10">
                        {r.artistImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.artistImageUrl} alt="" className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                      <span className="truncate text-sm text-white/70 group-hover:text-white">
                        {r.sub ?? r.label}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </BannerShell>
  )
}
