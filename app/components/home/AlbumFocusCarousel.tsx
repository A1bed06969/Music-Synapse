'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { UpcomingAlbumCard } from '@/utils/homeCards'

function formatShortDate(dateStr: string) {
  const [, m, d] = dateStr.split('-')
  return `${Number(m)}/${Number(d)}`
}

/** 近大ボイス風の「中央を大きく、両脇は小さく」なるスナップカルーセル。
 * IntersectionObserverでスクロールコンテナ中央に最も近い(=交差率が最も高い)
 * カードを検出し、そのカードだけ拡大・前面表示する。 */
export default function AlbumFocusCarousel({ albums }: { albums: UpcomingAlbumCard[] }) {
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
      // 左右20%ずつを除外し、コンテナ中央付近だけを判定対象にすることで
      // 「中央に来たカード」を検出する
      { root: container, threshold: Array.from({ length: 11 }, (_, i) => i / 10), rootMargin: '0px -30% 0px -30%' }
    )
    itemRefs.current.forEach((el) => el && observer.observe(el))
    return () => observer.disconnect()
  }, [albums.length])

  return (
    <div
      ref={containerRef}
      className="flex snap-x snap-mandatory gap-5 overflow-x-auto px-[32%] py-3 sm:px-[36%]"
      style={{ scrollbarWidth: 'none' }}
    >
      {albums.map((a, i) => {
        const isActive = i === activeIndex
        return (
          <div
            key={a.id}
            ref={(el) => {
              itemRefs.current[i] = el
            }}
            data-index={i}
            className="w-32 shrink-0 snap-center transition-all duration-300 ease-out sm:w-40"
            style={{
              transform: isActive ? 'scale(1.18) translateY(-4px)' : 'scale(0.82)',
              opacity: isActive ? 1 : 0.45,
              zIndex: isActive ? 10 : 1,
            }}
          >
            <Link href={`/albums/${a.id}`} className="group block">
              <div className="aspect-square overflow-hidden rounded-lg bg-white/5 shadow-xl shadow-black/60 ring-1 ring-white/10 transition group-hover:ring-white/40">
                {a.jacketUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.jacketUrl} alt={a.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-white/20">
                    No Art
                  </div>
                )}
              </div>
              <div className="mt-2">
                <p className="truncate text-xs font-medium text-white/90 group-hover:text-white">{a.title}</p>
                <p className="truncate text-[11px] text-white/40">{a.artistName}</p>
                <p className="text-[10px] text-white/25">{formatShortDate(a.releaseDate)}</p>
              </div>
            </Link>
          </div>
        )
      })}
    </div>
  )
}
