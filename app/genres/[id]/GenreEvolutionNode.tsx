import Link from 'next/link'

const EDGE_STYLE_LABEL: Record<'derivation' | 'influence' | 'crossover', string> = {
  derivation: '実線',
  influence: '点線',
  crossover: '破線',
}

export function EdgeLine({ relationType }: { relationType: 'derivation' | 'influence' | 'crossover' }) {
  const borderStyle = relationType === 'derivation' ? 'solid' : relationType === 'influence' ? 'dotted' : 'dashed'
  return <span className="h-4 w-4 border-l" style={{ borderLeftStyle: borderStyle, borderLeftColor: 'rgba(255,255,255,0.3)' }} />
}

export default function GenreEvolutionNode({
  genreId,
  name,
  incomingRelationType,
}: {
  genreId: string
  name: string
  incomingRelationType?: 'derivation' | 'influence' | 'crossover'
}) {
  return (
    <div className="flex items-center gap-1.5">
      {incomingRelationType && <EdgeLine relationType={incomingRelationType} />}
      <Link
        href={`/genres/${genreId}`}
        className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/75 transition hover:border-white/30 hover:bg-white/[0.05] hover:text-white"
      >
        {name}
      </Link>
    </div>
  )
}

export { EDGE_STYLE_LABEL }
