'use client'

import { useRef } from 'react'
import type { EraCardData } from '@/utils/genreHistory'
import EraCard, { COLOR_CLASSES } from './EraCard'

export default function EraTimeline({
  cards,
  selectedGenreId,
  onSelect,
}: {
  cards: EraCardData[]
  selectedGenreId: string | null
  onSelect: (genreId: string) => void
}) {
  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  function handleSelect(genreId: string) {
    onSelect(genreId)
    columnRefs.current.get(genreId)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }

  if (cards.length === 0) {
    return <p className="mt-4 text-sm text-white/40">まだ年表に表示できる出来事が登録されていません。</p>
  }

  return (
    <div className="mt-6">
      {/* ノード(円)とカードを同じ横スクロール領域内の1カラムにまとめることで、
          スクロール位置が常に一致するようにする(別々のスクロール領域だとズレる) */}
      <div className="flex snap-x items-start overflow-x-auto pb-4">
        {cards.map((card, i) => (
          <div key={card.genreId} className="flex items-start">
            <div
              className="flex w-56 shrink-0 flex-col items-center gap-4"
              ref={(el) => {
                if (el) columnRefs.current.set(card.genreId, el)
                else columnRefs.current.delete(card.genreId)
              }}
            >
              <button
                type="button"
                onClick={() => handleSelect(card.genreId)}
                className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 text-center text-[11px] font-semibold leading-tight transition ${
                  selectedGenreId === card.genreId
                    ? `${COLOR_CLASSES[card.colorToken].border} bg-white/10 text-white`
                    : 'border-white/15 text-white/50 hover:border-white/30'
                }`}
              >
                {card.period}
              </button>
              <EraCard card={card} isSelected={selectedGenreId === card.genreId} onSelect={() => handleSelect(card.genreId)} />
            </div>
            {/* w-40(160px) = 円の右端から次カラムの円の左端までの距離
                (カラム幅w-56=224px、円w-16=64pxなので片側の余白は80pxずつ、80+80=160px) */}
            {i < cards.length - 1 && <span className="mt-8 h-px w-40 shrink-0 bg-white/15" />}
          </div>
        ))}
      </div>
    </div>
  )
}
