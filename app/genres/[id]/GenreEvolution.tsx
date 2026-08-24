import type { GenreEvolutionNode as GenreEvolutionNodeData, GenreEvolutionEdgeData } from '@/utils/genreHistory'
import GenreEvolutionNode, { EDGE_STYLE_LABEL } from './GenreEvolutionNode'

export default function GenreEvolution({
  nodes,
}: {
  nodes: GenreEvolutionNodeData[]
  edges: GenreEvolutionEdgeData[]
}) {
  return (
    <div className="mt-4">
      <ul className="space-y-2">
        {nodes.map((node) => (
          <li key={node.genreId} style={{ marginLeft: `${node.depth * 1.5}rem` }}>
            <GenreEvolutionNode
              genreId={node.genreId}
              name={node.name}
              incomingRelationType={node.incomingRelationType ?? undefined}
            />
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-4 text-[11px] text-white/40">
        {(Object.keys(EDGE_STYLE_LABEL) as (keyof typeof EDGE_STYLE_LABEL)[]).map((relationType) => (
          <span key={relationType} className="flex items-center gap-1.5">
            <span
              className="inline-block h-0 w-4 border-t"
              style={{
                borderTopStyle: relationType === 'derivation' ? 'solid' : relationType === 'influence' ? 'dotted' : 'dashed',
                borderTopColor: 'rgba(255,255,255,0.4)',
              }}
            />
            {relationType === 'derivation' ? '主な派生' : relationType === 'influence' ? '影響' : 'クロスオーバー'}
          </span>
        ))}
      </div>
    </div>
  )
}
