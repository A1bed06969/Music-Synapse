'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { UpcomingFestivalCard } from '@/utils/homeCards'

function formatShortDate(dateStr: string) {
  const [, m, d] = dateStr.split('-')
  return `${Number(m)}/${Number(d)}`
}

function formatDateRange(start: string, end: string) {
  return start === end ? formatShortDate(start) : `${formatShortDate(start)} - ${formatShortDate(end)}`
}

/** AlbumFocusCarouselと同じ「中央フォーカス」スナップカルーセル。フェスビジュアルは
 * 縦横比がまちまちなので正方形ではなく縦長のカードにしている。 */
export default function FestivalFocusCarousel({
  festivals,
  accent,
}: {
  festivals: UpcomingFestivalCard[]
  accent: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new IntersectionObserver(
      (entries) => {
        let best: { index: number; ratio: number } | null = null
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.index)
          if (entry.intersectionRatio > (best?.ratio ?? 0)) {
            best = { index, ratio: entry.intersectionRatio }
          }
        }
        if (best) setActiveIndex(best.index)
      },
      { root: container, threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: '0px -30% 0px -30%' }
    )
    itemRefs.current.forEach((el) => el && observer.observe(el))
    return () => observer.disconnect()
  }, [festivals.length])

  return (
    <div
      ref={containerRef}
      className="flex snap-x snap-mandatory items-start gap-5 overflow-x-auto px-[28%] py-5 sm:px-[32%]"
      style={{ scrollbarWidth: 'none' }}
    >
      {festivals.map((f, i) => {
        const isActive = i === activeIndex
        return (
          <div
            key={f.id}
            ref={(el) => {
              itemRefs.current[i] = el
            }}
            data-index={i}
            className="relative w-40 shrink-0 snap-center sm:w-48"
            style={{ zIndex: isActive ? 10 : 1 }}
          >
            <Link href={`/events/${f.id}`} className="group block">
              {/* widthではなくtransform: scaleで拡大する(widthはレイアウトの再計算を
               * 伴うため、スクロール中に毎フレーム発生するとカクつく)。はみ出す分は
               * 常時mt-5で吸収する。縁取り(ring)は付けない(object-containで生じる
               * 余白/レターボックスまで枠として目立ってしまうため)、背景もページに
               * 馴染む色にする */}
              <div
                className="aspect-square origin-center overflow-hidden rounded-lg bg-[#0a0a0a] transition-transform duration-300 ease-out will-change-transform"
                style={{ transform: isActive ? 'scale(1.15)' : 'scale(0.85)' }}
              >
                {f.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.imageUrl} alt={f.name} className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-3xl">🎪</div>
                )}
              </div>
              <div className="mt-5 transition-opacity duration-300" style={{ opacity: isActive ? 1 : 0.45 }}>
                <p className="truncate text-xs font-semibold text-white group-hover:opacity-80">{f.name}</p>
                <p className="mt-0.5 truncate text-[11px] font-medium" style={{ color: accent }}>
                  {formatDateRange(f.startDate, f.endDate)}
                </p>
                {f.venue && <p className="truncate text-[10px] text-white/40">{f.venue}</p>}
              </div>
            </Link>
          </div>
        )
      })}
    </div>
  )
}
