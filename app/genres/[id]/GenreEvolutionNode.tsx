import Link from 'next/link'

export const EDGE_STYLE_LABEL: Record<'derivation' | 'influence' | 'crossover', string> = {
  derivation: '実線',
  influence: '点線',
  crossover: '破線',
}

export default function GenreEvolutionNode({
  genreId,
  name,
  isHighlighted = false,
  isDimmed = false,
  onHoverStart,
  onHoverEnd,
}: {
  genreId: string
  name: string
  isHighlighted?: boolean
  isDimmed?: boolean
  onHoverStart?: () => void
  onHoverEnd?: () => void
}) {
  return (
    <Link
      href={`/genres/${genreId}`}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      className={`whitespace-nowrap rounded-md border px-2.5 py-1 text-xs transition ${
        isHighlighted
          ? 'border-white/50 bg-white/[0.08] text-white'
          : 'border-white/10 text-white/75 hover:border-white/30 hover:bg-white/[0.05] hover:text-white'
      } ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
    >
      {name}
    </Link>
  )
}
