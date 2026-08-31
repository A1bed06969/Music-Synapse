'use client'

import Link from 'next/link'
import { startTransition, useEffect, useRef, useState } from 'react'
import { formatDate } from '@/utils/format'

export type RecentReleaseTrack = { id: string; trackNo: number | null; title: string }

export type RecentReleaseAlbum = {
  id: string
  title: string
  jacketUrl: string | null
  releaseDate: string
  artistId: string | null
  artistName: string
  artistImageUrl: string | null
  review: string | null
  tracks: RecentReleaseTrack[]
}

/** 新譜カレンダー上部の「今週の新譜ピックアップ」。左のジャケットカルーセルで
 * 中央フォーカスされたアルバムの詳細(アーティスト・収録曲・紹介文)を右側に
 * 表示する。中央フォーカス判定のロジック自体はホームのAlbumFocusCarouselと
 * 同じ(IntersectionObserverで各カードの交差率を保持し、tickごとに全体から
 * 最大値を選び直す)。 */
export default function RecentReleasesCarousel({ albums }: { albums: RecentReleaseAlbum[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const ratiosRef = useRef<number[]>([])

  function scrollToIndex(index: number) {
    const clamped = Math.max(0, Math.min(albums.length - 1, index))
    itemRefs.current[clamped]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    ratiosRef.current = new Array(albums.length).fill(0)

    // 先頭・末尾のカードはpx-[24%]等のパーセント指定と実際のカード幅の兼ね合いで
    // 「完全な中央」にわずかに届かないことがあり、そのぶん交差率が本来の1位を
    // 取れないことがある(実際に「一番最初のアルバムが紹介されない」不具合として
    // 発生)。スクロール位置が両端に達している間は交差率の比較より優先して
    // 先頭/末尾を採用する。IntersectionObserverの初回コールバックは非同期に
    // 発火するため、マウント直後に一度だけ判定しても後から上書きされてしまう
    // ——観測トリガーが何であれ必ずこの関数を経由させることで、判定のたびに
    // 境界チェックが効くようにする
    function computeActiveIndex(): number {
      if (container!.scrollLeft <= 2) return 0
      if (container!.scrollLeft >= container!.scrollWidth - container!.clientWidth - 2) return albums.length - 1

      let bestIndex = 0
      let bestRatio = -1
      ratiosRef.current.forEach((ratio, i) => {
        if (ratio > bestRatio) {
          bestRatio = ratio
          bestIndex = i
        }
      })
      return bestIndex
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.index)
          ratiosRef.current[index] = entry.intersectionRatio
        }
        startTransition(() => setActiveIndex(computeActiveIndex()))
      },
      { root: container, threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: '0px -30% 0px -30%' }
    )
    itemRefs.current.forEach((el) => el && observer.observe(el))

    function handleScroll() {
      startTransition(() => setActiveIndex(computeActiveIndex()))
    }
    handleScroll()
    container.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      observer.disconnect()
      container.removeEventListener('scroll', handleScroll)
    }
  }, [albums.length])

  if (albums.length === 0) return null

  const active = albums[activeIndex]

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-white/50">今週の新譜ピックアップ</h2>

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div className="relative">
          <div
            ref={containerRef}
            className="flex snap-x snap-mandatory items-start gap-6 overflow-x-auto px-[22%] py-4 sm:px-[30%] lg:px-[18%]"
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
                  className="relative w-44 shrink-0 snap-center sm:w-56"
                  style={{ zIndex: isActive ? 10 : 1 }}
                >
                  <Link href={`/albums/${a.id}`} className="group block">
                    <div
                      className="aspect-square origin-center overflow-hidden rounded-lg bg-white/5 shadow-xl shadow-black/60 ring-1 ring-white/10 transition-transform duration-300 ease-out will-change-transform group-hover:ring-white/40"
                      style={{ transform: isActive ? 'scale(1.22)' : 'scale(0.8)' }}
                    >
                      {a.jacketUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.jacketUrl} alt={a.title} className="h-full w-full object-contain" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-white/20">
                          No Art
                        </div>
                      )}
                    </div>
                    <div className="mt-5 transition-opacity duration-300" style={{ opacity: isActive ? 1 : 0.4 }}>
                      <p className="truncate text-xs font-medium text-white/90 group-hover:text-white">{a.title}</p>
                      <p className="truncate text-[11px] text-white/40">{a.artistName}</p>
                    </div>
                  </Link>
                </div>
              )
            })}
          </div>

          <button
            type="button"
            onClick={() => scrollToIndex(activeIndex - 1)}
            disabled={activeIndex === 0}
            aria-label="前のアルバムへ"
            className="absolute left-0 top-[32%] z-20 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white/90 backdrop-blur transition hover:bg-black/80 disabled:pointer-events-none disabled:opacity-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => scrollToIndex(activeIndex + 1)}
            disabled={activeIndex === albums.length - 1}
            aria-label="次のアルバムへ"
            className="absolute right-0 top-[32%] z-20 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white/90 backdrop-blur transition hover:bg-black/80 disabled:pointer-events-none disabled:opacity-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M9 6L15 12L9 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* フォーカス中のアルバムの詳細。カルーセル側の状態(activeIndex)をそのまま
         * 参照するだけなので、スクロールに合わせて自動的に切り替わる */}
        <div key={active.id} className="animate-banner-in rounded-lg border border-white/10 bg-white/[0.02] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <Link href={`/artists/${active.artistId ?? ''}`} className="shrink-0">
                <div className="h-12 w-12 overflow-hidden rounded-full bg-white/5 ring-1 ring-white/10">
                  {active.artistImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={active.artistImageUrl} alt={active.artistName} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-lg text-white/20">🎤</div>
                  )}
                </div>
              </Link>
              <div>
                <Link href={`/artists/${active.artistId ?? ''}`} className="text-sm font-medium text-white/80 hover:text-white">
                  {active.artistName}
                </Link>
                {active.artistId && (
                  <Link
                    href={`/artists/${active.artistId}`}
                    className="block text-xs text-white/40 hover:text-white/70"
                  >
                    プロフィールを見る →
                  </Link>
                )}
              </div>
            </div>
            <p className="text-xs text-white/40">{formatDate(active.releaseDate)}</p>
          </div>

          <Link href={`/albums/${active.id}`} className="mt-1 block text-lg font-bold hover:opacity-80">
            {active.title}
          </Link>

          {active.tracks.length > 0 && (
            // 9曲を超えると縦スクロールに隠れてしまっていたため、2段組みにして
            // 10曲目以降は隣の列へ折り返す(それでも収まりきらない大曲数の
            // アルバムのみ、保険として縦スクロールも残す)
            <ol className="mt-3 max-h-64 columns-2 gap-x-4 overflow-y-auto text-sm text-white/60">
              {active.tracks.map((t) => (
                <li key={t.id} className="flex gap-2 break-inside-avoid py-0.5">
                  <span className="w-5 shrink-0 text-right text-white/30">{t.trackNo ?? '-'}</span>
                  <span className="min-w-0 truncate">{t.title}</span>
                </li>
              ))}
            </ol>
          )}

          {active.review ? (
            <p className="mt-3 text-sm leading-relaxed text-white/70">{active.review}</p>
          ) : (
            <p className="mt-3 text-xs text-white/25">紹介文はまだ登録されていません。</p>
          )}
        </div>
      </div>
    </section>
  )
}
