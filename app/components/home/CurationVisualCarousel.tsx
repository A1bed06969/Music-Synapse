'use client'

// ⑥Media Curation Express: 各メディアの企画ビジュアルを1枚ずつ切り替えて見せるカルーセル。
// 5秒ごとに次へ進み、カーソルを合わせている間・操作した直後は止まる。ビジュアルが無い企画は選出作品の画像を並べる。
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { artworkAt } from '@/utils/artworkSize'
import type { CurationCard } from '@/utils/homeCardsMore'

const INTERVAL_MS = 5000

export default function CurationVisualCarousel({ curations, accent }: { curations: CurationCard[]; accent: string }) {
  const [index, setIndex] = useState(0)
  const pausedUntil = useRef(0)
  const hovering = useRef(false)

  useEffect(() => {
    if (curations.length < 2) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(() => {
      if (hovering.current || Date.now() < pausedUntil.current) return
      setIndex((i) => (i + 1) % curations.length)
    }, INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [curations.length])

  function go(i: number) {
    pausedUntil.current = Date.now() + INTERVAL_MS * 2
    setIndex((i + curations.length) % curations.length)
  }

  return (
    <div className="w-full" onMouseEnter={() => (hovering.current = true)} onMouseLeave={() => (hovering.current = false)}>
      <div className="relative overflow-hidden rounded-xl ring-1 ring-white/10">
        {/* スライドではなく重ねて切り替える(横に並べると端数のずれで隣の画像が細く覗くため) */}
        <div className="relative aspect-[16/10] w-full">
          {curations.map((c, i) => (
            <Link
              key={c.id}
              href={`/media/features/${c.id}`}
              className={`group absolute inset-0 block transition-opacity duration-700 ${i === index ? 'z-[1] opacity-100' : 'pointer-events-none opacity-0'}`}
              aria-hidden={i !== index}
              tabIndex={i === index ? 0 : -1}
            >
              {c.visualUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.visualUrl} alt="" className="h-full w-full object-cover transition group-hover:scale-[1.02]" loading={i === 0 ? 'eager' : 'lazy'} referrerPolicy="no-referrer" />
              ) : (
                <div className="grid h-full w-full grid-cols-4 bg-black">
                  {c.images.map((u, k) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={k} src={artworkAt(u, 300) ?? u} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ))}
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold tracking-[0.15em]" style={{ color: accent }}>
                    {c.mediaName.toUpperCase()}
                  </p>
                  <p className="truncate text-base font-bold text-white @sm:text-lg">{c.name}</p>
                </div>
                <p className="shrink-0 text-xs font-bold tabular-nums text-white/80">
                  <span style={{ color: accent }}>{c.entryCount.toLocaleString()}</span> 件
                </p>
              </div>
            </Link>
          ))}
        </div>
        {curations.length > 1 && (
          <>
            <button type="button" aria-label="前へ" onClick={() => go(index - 1)} className="absolute left-2 top-1/2 z-[2] flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition hover:bg-black/70">
              ‹
            </button>
            <button type="button" aria-label="次へ" onClick={() => go(index + 1)} className="absolute right-2 top-1/2 z-[2] flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition hover:bg-black/70">
              ›
            </button>
          </>
        )}
      </div>
      <div className="mt-3 flex justify-center gap-1.5">
        {curations.map((c, i) => (
          <button
            key={c.id}
            type="button"
            aria-label={`${c.name}を表示`}
            onClick={() => go(i)}
            className="h-1.5 rounded-full transition-all"
            style={{ width: i === index ? 20 : 6, backgroundColor: i === index ? accent : 'rgba(255,255,255,0.25)' }}
          />
        ))}
      </div>
    </div>
  )
}
