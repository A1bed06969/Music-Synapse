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
      { root: container, threshold: Array.from({ length: 11 }, (_, i) => i / 10), rootMargin: '0px -30% 0px -30%' }
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
            className="relative shrink-0 snap-center transition-[width] duration-300 ease-out"
            style={{ width: isActive ? '13rem' : '10rem', zIndex: isActive ? 10 : 1 }}
          >
            <Link href={`/events/${f.id}`} className="group block">
              {/* 実際の幅(width)を変える方式(transform: scaleだと拡大時に見た目だけ
               * 下のキャプションへはみ出して重なってしまっていた)。フェスのビジュアルは
               * 縁取り(ring)を付けると、object-containで生じる余白(レターボックス)まで
               * 枠として目立ってしまうため、リング無し・背景もページに馴染む色にする */}
              <div className="aspect-square w-full overflow-hidden rounded-lg bg-[#0a0a0a] transition">
                {f.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.imageUrl} alt={f.name} className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-3xl">🎪</div>
                )}
              </div>
              <div className="mt-2 transition-opacity duration-300" style={{ opacity: isActive ? 1 : 0.45 }}>
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
