'use client'

import { useRef } from 'react'
import type { EraCardData } from '@/utils/genreHistory'
import EraCard, { COLOR_CLASSES, CARD_WIDTH_CLASS } from './EraCard'

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
      {/* ノード(円)とカードは同じ横スクロール領域の1カラムにまとめ、常に連動して動くようにする。
          円をつなぐ線は1本の背景線として敷き、円自体は背景と同じ色で塗って線を隠すことで
          「線の上に円が乗っている」タイムラインの見た目にする(カード幅が可変でも計算不要)。 */}
      <div className="relative flex snap-x items-start gap-4 overflow-x-auto pb-4">
        <div className="pointer-events-none absolute left-8 right-8 top-8 h-px bg-white/15" />
        {cards.map((card) => (
          <div
            key={card.genreId}
            className={`flex ${CARD_WIDTH_CLASS} shrink-0 flex-col items-center gap-4`}
            ref={(el) => {
              if (el) columnRefs.current.set(card.genreId, el)
              else columnRefs.current.delete(card.genreId)
            }}
          >
            <button
              type="button"
              onClick={() => handleSelect(card.genreId)}
              className={`relative z-10 flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 text-center text-[11px] font-semibold leading-tight transition ${
                selectedGenreId === card.genreId
                  ? `${COLOR_CLASSES[card.colorToken].border} bg-white/10 text-white`
                  : 'border-white/15 bg-[#0a0a0a] text-white/50 hover:border-white/30'
              }`}
            >
              {card.period}
            </button>
            <EraCard card={card} isSelected={selectedGenreId === card.genreId} onSelect={() => handleSelect(card.genreId)} />
          </div>
        ))}
      </div>
    </div>
  )
}
