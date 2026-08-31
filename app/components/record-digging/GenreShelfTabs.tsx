'use client'

import type { DiggingShelf } from '@/utils/recordDigging'

/** 参考画像の仕切り札のように、現在の棚名を強調表示し、その左右に前後の棚名を
 * 薄く覗かせる(左右スワイプで棚が変わることの示唆になる)。棚が1つしか無ければ
 * 前後は表示しない。 */
export default function GenreShelfTabs({
  shelves,
  currentIndex,
}: {
  shelves: DiggingShelf[]
  currentIndex: number
}) {
  if (shelves.length === 0) return null
  const showNeighbors = shelves.length > 1
  const prev = shelves[(currentIndex - 1 + shelves.length) % shelves.length]
  const current = shelves[currentIndex]
  const next = shelves[(currentIndex + 1) % shelves.length]

  return (
    <div className="relative z-10 flex items-center justify-center gap-3 px-4 text-center">
      {showNeighbors && <span className="truncate text-xs text-white/25">{prev.label}</span>}
      <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-4 py-1.5 text-sm font-semibold tracking-wide text-amber-200">
        {current.label}
      </span>
      {showNeighbors && <span className="truncate text-xs text-white/25">{next.label}</span>}
    </div>
  )
}
