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
      className="flex snap-x snap-mandatory items-center gap-5 overflow-x-auto px-[28%] py-5 sm:px-[32%]"
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
              {/* 拡大縮小はビジュアル自体だけにかける(キャプションまで拡大すると
               * カードの縦幅がスクロールコンテナの余白を超えて見切れてしまうため) */}
              <div
                className="aspect-square overflow-hidden rounded-lg bg-white/5 shadow-xl shadow-black/60 ring-1 ring-white/10 transition-all duration-300 ease-out group-hover:ring-white/40"
                style={{ transform: isActive ? 'scale(1.15)' : 'scale(0.82)' }}
              >
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
