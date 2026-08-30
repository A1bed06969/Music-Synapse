'use client'

import Link from 'next/link'
import { startTransition, useEffect, useRef, useState } from 'react'
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
  // AlbumFocusCarouselと同じ理由で、各カードの最新の交差率を保持し、その
  // tickのentriesだけでなく全カード分から最大値を選び直す(速いスクロール中に
  // 一つ前のカードへ戻ったり2つ先へ飛んだりする不具合を防ぐ)
  const ratiosRef = useRef<number[]>([])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    ratiosRef.current = new Array(festivals.length).fill(0)

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.index)
          ratiosRef.current[index] = entry.intersectionRatio
        }
        let bestIndex = 0
        let bestRatio = -1
        ratiosRef.current.forEach((ratio, i) => {
          if (ratio > bestRatio) {
            bestRatio = ratio
            bestIndex = i
          }
        })
        startTransition(() => setActiveIndex(bestIndex))
      },
      { root: container, threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: '0px -30% 0px -30%' }
    )
    itemRefs.current.forEach((el) => el && observer.observe(el))
    return () => observer.disconnect()
  }, [festivals.length])

  return (
    <div
      ref={containerRef}
      className="flex w-full snap-x snap-mandatory items-start gap-6 overflow-x-auto px-[22%] py-4 sm:px-[30%]"
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
            className="relative w-48 shrink-0 snap-center sm:w-64"
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
                style={{ transform: isActive ? 'scale(1.2)' : 'scale(0.8)' }}
              >
                {f.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.imageUrl} alt={f.name} className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-3xl">🎪</div>
                )}
              </div>
              <div className="mt-6 transition-opacity duration-300" style={{ opacity: isActive ? 1 : 0.45 }}>
                <p className="truncate text-xs font-semibold text-white group-hover:opacity-80 sm:text-sm">{f.name}</p>
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
