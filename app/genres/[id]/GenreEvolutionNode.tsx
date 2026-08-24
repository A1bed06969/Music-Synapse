import Link from 'next/link'

export const EDGE_STYLE_LABEL: Record<'derivation' | 'influence' | 'crossover', string> = {
  derivation: '実線',
  influence: '点線',
  crossover: '破線',
}

export default function GenreEvolutionNode({ genreId, name }: { genreId: string; name: string }) {
  return (
    <Link
      href={`/genres/${genreId}`}
      className="whitespace-nowrap rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/75 transition hover:border-white/30 hover:bg-white/[0.05] hover:text-white"
    >
      {name}
    </Link>
  )
}
