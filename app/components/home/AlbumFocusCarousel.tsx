'use client'

import Link from 'next/link'
import { startTransition, useEffect, useRef, useState } from 'react'
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
  // 各カードの最新の交差率を保持する。IntersectionObserverのコールバックには
  // 「このtickで閾値をまたいだ要素」しか渡ってこないため、その場のentriesだけで
  // 最大値を決めると、本当は中央にいるカードがこのtickで閾値をまたいでおらず
  // entriesに含まれない場合、無関係な(通過中の)カードが誤って選ばれてしまう
  // (速いスクロール中に一つ前のカードへ戻ったり、2つ先へ飛んだりする不具合の原因)。
  // 全カード分のスコアを保持し、毎回その全体から最大値を選び直すことで解消する。
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
    // 「完全な中央」にわずかに届かないことがあり、そのぶん交差率の比較だけでは
    // 先頭カードが1位を取れないことがある。スクロール位置が両端に達している間は
    // 比較より優先して先頭/末尾を採用する。IntersectionObserverの初回コール
    // バックは非同期に発火するため、マウント直後に一度だけ判定しても後から
    // 上書きされてしまう——観測トリガーが何であれ必ずこの関数を経由させることで、
    // 判定のたびに境界チェックが効くようにする
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
        // スクロール操作自体をブロックしないよう、活性カードの切り替えは
        // 優先度の低い更新として扱う
        startTransition(() => setActiveIndex(computeActiveIndex()))
      },
      // 左右20%ずつを除外し、コンテナ中央付近だけを判定対象にすることで
      // 「中央に来たカード」を検出する
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

  return (
    <div className="relative w-full">
      <div
        ref={containerRef}
        className="flex w-full snap-x snap-mandatory items-start gap-6 overflow-x-auto px-[24%] py-4 @sm:px-[32%]"
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
              className="relative w-36 shrink-0 snap-center @sm:w-48"
              style={{ zIndex: isActive ? 10 : 1 }}
            >
              <Link href={`/albums/${a.id}`} className="group block">
                {/* widthではなくtransform: scaleで拡大する(widthはレイアウトの
                 * 再計算を伴うため、スクロール中に毎フレーム発生するとカクつく。
                 * transformはコンポジタだけで完結するので滑らか)。かわりに、
                 * 最大拡大時にはみ出す分を常時mt-5で吸収し、キャプションと
                 * 重ならないようにする */}
                <div
                  className="aspect-square origin-center overflow-hidden rounded-lg bg-white/5 shadow-xl shadow-black/60 ring-1 ring-white/10 transition-transform duration-300 ease-out will-change-transform group-hover:ring-white/40"
                  style={{ transform: isActive ? 'scale(1.15)' : 'scale(0.8)' }}
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
                <div className="mt-6 transition-opacity duration-300" style={{ opacity: isActive ? 1 : 0.45 }}>
                  <p className="truncate text-xs font-medium text-white/90 group-hover:text-white @sm:text-sm">{a.title}</p>
                  <p className="truncate text-[11px] text-white/40 @sm:text-xs">{a.artistName}</p>
                  <p className="text-[10px] text-white/25">{formatShortDate(a.releaseDate)}</p>
                </div>
              </Link>
            </div>
          )
        })}
      </div>

      {/* トラックパッドの横スワイプが無いPC環境でも操作できるよう、前後ボタンを
       * 用意する。キャプション分だけ見た目の重心が下にずれるため、ジャケット
       * 画像の中央あたり(行全体の中央より上寄り)にボタンを合わせる */}
      <button
        type="button"
        onClick={() => scrollToIndex(activeIndex - 1)}
        disabled={activeIndex === 0}
        aria-label="前のアルバムへ"
        className="absolute left-0 top-[34%] z-20 -translate-y-1/2 rounded-full bg-black/60 p-1.5 text-white/90 backdrop-blur transition hover:bg-black/80 disabled:pointer-events-none disabled:opacity-0 @sm:p-2"
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
        className="absolute right-0 top-[34%] z-20 -translate-y-1/2 rounded-full bg-black/60 p-1.5 text-white/90 backdrop-blur transition hover:bg-black/80 disabled:pointer-events-none disabled:opacity-0 @sm:p-2"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M9 6L15 12L9 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}
