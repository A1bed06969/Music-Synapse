'use client'

import type { DiggingShelf } from '@/utils/recordDigging'

/** 画面下部の棚選択レール。実カタログの代表ジャケットをサムネイルとして
 * 並べ、タップで直接その棚へジャンプできる(左右スワイプでの1つずつの
 * 移動とは別の、一覧から選ぶ導線)。「レコードショップの棚札」に寄せて、
 * 情報は棚名・枚数・サムネイルのみに絞る。 */
export default function ShelfPicker({
  shelves,
  currentIndex,
  onSelect,
}: {
  shelves: DiggingShelf[]
  currentIndex: number
  onSelect: (index: number) => void
}) {
  if (shelves.length <= 1) return null

  return (
    <div className="relative z-10">
      <p className="px-4 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30">Choose Your Shelf</p>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4" style={{ scrollbarWidth: 'none' }}>
        {shelves.map((shelf, i) => {
          const isActive = i === currentIndex
          return (
            <button
              key={shelf.key}
              type="button"
              onClick={() => onSelect(i)}
              className={`flex shrink-0 snap-start flex-col items-center gap-1.5 rounded-md border px-2 pb-2 pt-1.5 transition ${
                isActive ? 'border-amber-400/60 bg-amber-400/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
              }`}
            >
              <div className="relative h-14 w-14 overflow-hidden rounded-[3px] bg-white/5 shadow-md shadow-black/50">
                {shelf.sampleJacketUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={shelf.sampleJacketUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-white/15">🎵</div>
                )}
              </div>
              <span className={`max-w-16 truncate text-[10px] font-medium ${isActive ? 'text-amber-200' : 'text-white/50'}`}>
                {shelf.label}
              </span>
              {shelf.albumCount != null && <span className="text-[9px] text-white/25">{shelf.albumCount} albums</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
