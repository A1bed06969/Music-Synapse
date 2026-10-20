'use client'

// TOPページのバナー共通の「大きい画像を1枚ずつ切り替える」カルーセル(①Discover New Music・②Fes & Live Freak)。
// 5秒ごとに次へ進み、カーソルを合わせている間・操作した直後は止まる。
// 画像は枠に全体を収め(縦長・横長・正方形どれでも切れすぎない)、余白には同じ画像をぼかして敷く。
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

const INTERVAL_MS = 5000

export type VisualSlide = {
  id: string
  href: string
  imageUrl: string | null
  /** 画像の上の小さな見出し(日付など。アクセント色) */
  eyebrow: string
  title: string
  sub?: string | null
}

export default function VisualCarousel({ slides, accent }: { slides: VisualSlide[]; accent: string }) {
  const [index, setIndex] = useState(0)
  const pausedUntil = useRef(0)
  const hovering = useRef(false)

  useEffect(() => {
    if (slides.length < 2) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(() => {
      if (hovering.current || Date.now() < pausedUntil.current) return
      setIndex((i) => (i + 1) % slides.length)
    }, INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [slides.length])

  function go(i: number) {
    pausedUntil.current = Date.now() + INTERVAL_MS * 2
    setIndex((i + slides.length) % slides.length)
  }

  return (
    <div className="w-full" onMouseEnter={() => (hovering.current = true)} onMouseLeave={() => (hovering.current = false)}>
      <div className="relative overflow-hidden rounded-xl ring-1 ring-white/10">
        <div className="relative aspect-[16/10] w-full bg-black">
          {slides.map((s, i) => (
            <Link
              key={s.id}
              href={s.href}
              className={`group absolute inset-0 block transition-opacity duration-700 ${i === index ? 'z-[1] opacity-100' : 'pointer-events-none opacity-0'}`}
              aria-hidden={i !== index}
              tabIndex={i === index ? 0 : -1}
            >
              {s.imageUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.imageUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-xl" loading="lazy" referrerPolicy="no-referrer" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.imageUrl} alt={s.title} className="relative h-full w-full object-contain transition group-hover:scale-[1.02]" loading={i === 0 ? 'eager' : 'lazy'} referrerPolicy="no-referrer" />
                </>
              ) : (
                <div className="flex h-full w-full items-center justify-center p-6" style={{ background: `radial-gradient(circle at 70% 30%, ${accent}40, #050505 70%)` }}>
                  <p className="text-center text-2xl font-black text-white/80">{s.title}</p>
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-4">
                <p className="text-[11px] font-bold tracking-[0.1em]" style={{ color: accent }}>
                  {s.eyebrow}
                </p>
                <p className="truncate text-base font-bold text-white @sm:text-lg">{s.title}</p>
                {s.sub && <p className="truncate text-xs text-white/60">{s.sub}</p>}
              </div>
            </Link>
          ))}
        </div>
        {slides.length > 1 && (
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
      {slides.length > 1 && (
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={`${s.title}を表示`}
              onClick={() => go(i)}
              className="h-1.5 rounded-full transition-all"
              style={{ width: i === index ? 20 : 6, backgroundColor: i === index ? accent : 'rgba(255,255,255,0.25)' }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
