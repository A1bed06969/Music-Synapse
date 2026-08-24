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
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  function handleSelect(genreId: string) {
    onSelect(genreId)
    cardRefs.current.get(genreId)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }

  if (cards.length === 0) {
    return <p className="mt-4 text-sm text-white/40">まだ年表に表示できる出来事が登録されていません。</p>
  }

  return (
    <div className="mt-6">
      {/* 円形ノード+接続ライン(横一列) */}
      <div className="flex items-center overflow-x-auto pb-2">
        {cards.map((card, i) => (
          <div key={card.genreId} className="flex shrink-0 items-center">
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
            {i < cards.length - 1 && <span className="mx-1 h-px w-8 shrink-0 bg-white/15" />}
          </div>
        ))}
      </div>

      {/* カード本体(横スクロール、スマホでも横スクロールのまま) */}
      <div className="mt-4 flex snap-x gap-4 overflow-x-auto pb-4">
        {cards.map((card) => (
          <div
            key={card.genreId}
            ref={(el) => {
              if (el) cardRefs.current.set(card.genreId, el)
              else cardRefs.current.delete(card.genreId)
            }}
          >
            <EraCard card={card} isSelected={selectedGenreId === card.genreId} onSelect={() => handleSelect(card.genreId)} />
          </div>
        ))}
      </div>
    </div>
  )
}
