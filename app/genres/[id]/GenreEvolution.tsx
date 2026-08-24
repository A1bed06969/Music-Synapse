'use client'

import { useMemo, useState } from 'react'
import type { GenreEvolutionNode as GenreEvolutionNodeData, GenreEvolutionEdgeData } from '@/utils/genreHistory'
import GenreEvolutionNode, { EDGE_STYLE_LABEL } from './GenreEvolutionNode'

type RelationType = 'derivation' | 'influence' | 'crossover'

function borderStyleFor(relationType: RelationType | null): 'solid' | 'dotted' | 'dashed' {
  if (relationType === 'influence') return 'dotted'
  if (relationType === 'crossover') return 'dashed'
  return 'solid'
}

/** 各子ジャンルの「ツリー上の親」を1つだけ確定させる。
 * 複数のエッジが同じ子を指す(ダイヤモンド構造)場合は、pre-order(edges配列)で
 * 最初に到達したエッジが親になる — これはutils/genreHistory.tsのbuildGenreEvolutionTreeが
 * 各ノードのincomingRelationTypeを決めたのと同じルールなので、線のスタイルと
 * ツリー構造の親子関係が必ず一致する。 */
function buildChildrenByParent(nodes: GenreEvolutionNodeData[], edges: GenreEvolutionEdgeData[]) {
  const rootId = nodes.find((n) => n.depth === 0)?.genreId ?? null
  const claimed = new Set<string>(rootId ? [rootId] : [])
  const childrenByParent = new Map<string, string[]>()
  for (const edge of edges) {
    if (claimed.has(edge.toGenreId)) continue
    claimed.add(edge.toGenreId)
    const list = childrenByParent.get(edge.fromGenreId) ?? []
    list.push(edge.toGenreId)
    childrenByParent.set(edge.fromGenreId, list)
  }
  return { rootId, childrenByParent }
}

/** hoveredIdからルートまで、parentGenreIdを遡ってノードIDの集合を作る
 * (系統をたどるパスをハイライトするため)。 */
function pathToRoot(hoveredId: string, nodeById: Map<string, GenreEvolutionNodeData>): Set<string> {
  const path = new Set<string>()
  let current: string | undefined = hoveredId
  while (current) {
    path.add(current)
    current = nodeById.get(current)?.parentGenreId ?? undefined
  }
  return path
}

function TreeRow({
  genreId,
  nodeById,
  childrenByParent,
  ancestorContinues,
  isLast,
  highlightedPath,
  onHoverStart,
  onHoverEnd,
}: {
  genreId: string
  nodeById: Map<string, GenreEvolutionNodeData>
  childrenByParent: Map<string, string[]>
  ancestorContinues: boolean[]
  isLast: boolean
  highlightedPath: Set<string> | null
  onHoverStart: (genreId: string) => void
  onHoverEnd: () => void
}) {
  const node = nodeById.get(genreId)
  if (!node) return null
  const children = childrenByParent.get(genreId) ?? []
  const lineStyle = borderStyleFor(node.incomingRelationType)
  const isHighlighted = highlightedPath?.has(genreId) ?? false
  const isDimmed = highlightedPath !== null && !isHighlighted

  return (
    <li>
      <div className="flex h-8 items-center">
        {ancestorContinues.map((continues, i) => (
          <span key={i} className="relative h-8 w-6 shrink-0">
            {continues && (
              <span
                className="absolute left-1/2 top-0 h-full"
                style={{ borderLeftWidth: 1, borderLeftStyle: 'solid', borderLeftColor: 'rgba(255,255,255,0.15)' }}
              />
            )}
          </span>
        ))}
        {node.depth > 0 && (
          <span className="relative h-8 w-6 shrink-0">
            <span
              className="absolute left-1/2"
              style={{
                top: 0,
                height: isLast ? '50%' : '100%',
                borderLeftWidth: 1,
                borderLeftStyle: lineStyle,
                borderLeftColor: 'rgba(255,255,255,0.35)',
              }}
            />
            <span
              className="absolute left-1/2 w-1/2"
              style={{ top: '50%', borderTopWidth: 1, borderTopStyle: lineStyle, borderTopColor: 'rgba(255,255,255,0.35)' }}
            />
          </span>
        )}
        <GenreEvolutionNode
          genreId={node.genreId}
          name={node.name}
          isHighlighted={isHighlighted}
          isDimmed={isDimmed}
          onHoverStart={() => onHoverStart(genreId)}
          onHoverEnd={onHoverEnd}
        />
      </div>

      {children.length > 0 && (
        <ul>
          {children.map((childId, i) => (
            <TreeRow
              key={childId}
              genreId={childId}
              nodeById={nodeById}
              childrenByParent={childrenByParent}
              ancestorContinues={node.depth > 0 ? [...ancestorContinues, !isLast] : ancestorContinues}
              isLast={i === children.length - 1}
              highlightedPath={highlightedPath}
              onHoverStart={onHoverStart}
              onHoverEnd={onHoverEnd}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function GenreEvolution({
  nodes,
  edges,
}: {
  nodes: GenreEvolutionNodeData[]
  edges: GenreEvolutionEdgeData[]
}) {
  const [hoveredGenreId, setHoveredGenreId] = useState<string | null>(null)
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.genreId, n])), [nodes])
  const { rootId, childrenByParent } = useMemo(() => buildChildrenByParent(nodes, edges), [nodes, edges])
  const highlightedPath = hoveredGenreId ? pathToRoot(hoveredGenreId, nodeById) : null

  return (
    <div className="mt-4">
      {rootId && (
        <ul>
          <TreeRow
            genreId={rootId}
            nodeById={nodeById}
            childrenByParent={childrenByParent}
            ancestorContinues={[]}
            isLast={true}
            highlightedPath={highlightedPath}
            onHoverStart={setHoveredGenreId}
            onHoverEnd={() => setHoveredGenreId(null)}
          />
        </ul>
      )}

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
