'use client'

import { useState } from 'react'
import type { EraCardData, EraColorToken } from '@/utils/genreHistory'

// 100vw-3rem(ページ左右のpx-6分)を上限にすることで狭い画面では画面幅いっぱいまで広がり、
// 広い画面では28rem(448px)で頭打ちにしてカード1枚が間延びしないようにする。
// md以上(PC想定)ではさらに16rem(256px)まで縮小し、カード列と下の詳細パネルが
// スクロールなしで同時に見えるサイズ感にする(スマホは操作性優先でこのままの大きさ)
export const CARD_WIDTH_CLASS = 'w-[min(calc(100vw-3rem),28rem)] md:w-64'

const COLOR_CLASSES: Record<EraColorToken, { ring: string; border: string; text: string; triangle: string }> = {
  amber: { ring: 'ring-amber-400/50', border: 'border-amber-400/60', text: 'text-amber-400', triangle: 'border-t-amber-400' },
  yellow: { ring: 'ring-yellow-300/50', border: 'border-yellow-300/60', text: 'text-yellow-300', triangle: 'border-t-yellow-300' },
  green: { ring: 'ring-emerald-400/50', border: 'border-emerald-400/60', text: 'text-emerald-400', triangle: 'border-t-emerald-400' },
  blue: { ring: 'ring-sky-400/50', border: 'border-sky-400/60', text: 'text-sky-400', triangle: 'border-t-sky-400' },
  coral: { ring: 'ring-orange-400/50', border: 'border-orange-400/60', text: 'text-orange-400', triangle: 'border-t-orange-400' },
  purple: { ring: 'ring-violet-400/50', border: 'border-violet-400/60', text: 'text-violet-400', triangle: 'border-t-violet-400' },
}

function CardImage({ card }: { card: EraCardData }) {
  const [loadFailed, setLoadFailed] = useState(false)

  if (!card.imageUrl || loadFailed) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-2xl font-bold text-white/20">
        {card.title.slice(0, 1)}
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={card.imageUrl}
      alt={card.title}
      onError={() => setLoadFailed(true)}
      className="aspect-square w-full rounded-md object-cover transition duration-300 group-hover:scale-105"
    />
  )
}

export default function EraCard({
  card,
  isSelected,
  onSelect,
  dimmed = false,
}: {
  card: EraCardData
  isSelected: boolean
  onSelect: () => void
  dimmed?: boolean
}) {
  const colors = COLOR_CLASSES[card.colorToken]
  const primaryArtist = card.representativeArtists[0]
  const primaryWork = card.representativeWorks[0]

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group flex ${CARD_WIDTH_CLASS} shrink-0 snap-start flex-col rounded-lg border bg-[#141414] p-4 text-left transition duration-200 hover:-translate-y-1 hover:border-white/40 ${
        isSelected ? `${colors.border} ring-2 ${colors.ring}` : 'border-white/10'
      } ${dimmed ? 'opacity-40' : 'opacity-100'}`}
    >
      <p className={`text-xs font-semibold uppercase tracking-wide ${colors.text}`}>{card.period}</p>
      <h3 className="mt-1 line-clamp-2 text-sm font-bold leading-snug text-white/90">{card.title}</h3>

      <div className="mt-3">
        <CardImage card={card} />
      </div>

      <div className="mt-3 min-h-[2.5rem] text-xs text-white/60">
        {primaryArtist && <p className="truncate font-medium text-white/80">{primaryArtist.name}</p>}
        {primaryWork && (
          <p className="truncate">
            「{primaryWork.title}」{primaryWork.year ? `(${primaryWork.year})` : ''}
          </p>
        )}
      </div>

      <span className="mt-3 flex items-center gap-1 text-xs text-white/40 transition group-hover:translate-x-0.5 group-hover:text-white/70">
        詳細を見る <span aria-hidden>→</span>
      </span>

      {isSelected && (
        <span className={`mx-auto mt-2 h-0 w-0 border-x-8 border-t-8 border-x-transparent ${colors.triangle}`} />
      )}
    </button>
  )
}

export { COLOR_CLASSES }
export type { EraColorToken as EraCardColorToken }
