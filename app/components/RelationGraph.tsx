'use client'

import { useRouter } from 'next/navigation'

export type RelationNode = { id: string; name: string; category?: string | null; type?: 'artist' | 'person' }
export type RelationEdge = {
  source: string
  target: string
  style: 'solid' | 'dotted'
  label?: string | null
}

const UNCATEGORIZED = 'その他'

// 隣接するカテゴリー同士でも見分けやすいよう、彩度・明度を散らした配色
const CATEGORY_PALETTE = [
  '#e85d5d', // レッド
  '#e8a63c', // アンバー
  '#7fc97f', // グリーン
  '#5aa9e6', // スカイブルー
  '#b57bdc', // パープル
  '#e0c341', // イエロー
  '#4fc3c0', // ティール
  '#e77fa8', // ピンク
]

function colorForCategory(category: string) {
  let hash = 0
  for (let i = 0; i < category.length; i++) {
    hash = (hash * 31 + category.charCodeAt(i)) >>> 0
  }
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length]
}

/** source→targetへの直角(エルボー)接続パス。中間で1回だけ折れ曲がる。 */
function elbowPath(sx: number, sy: number, tx: number, ty: number): string {
  if (sy === ty) return `M ${sx},${sy} H ${tx}`
  const midX = sx + (tx - sx) / 2
  return `M ${sx},${sy} H ${midX} V ${ty} H ${tx}`
}

const ROW_HEIGHT = 40
const GROUP_GAP = 22
const NODE_R_ROOT = 9
const NODE_R = 6

function groupByCategory(nodes: RelationNode[]) {
  const groups = new Map<string, RelationNode[]>()
  for (const node of nodes) {
    const key = node.category ?? UNCATEGORIZED
    const list = groups.get(key) ?? []
    list.push(node)
    groups.set(key, list)
  }
  return Array.from(groups.entries())
}

/** 中心アーティスト1人から右へ枝が伸びる木構造レイアウト。 */
function EgoTree({
  nodes,
  edges,
  centerId,
}: {
  nodes: RelationNode[]
  edges: RelationEdge[]
  centerId: string
}) {
  const router = useRouter()
  const center = nodes.find((n) => n.id === centerId)
  const children = nodes.filter((n) => n.id !== centerId)
  const groups = groupByCategory(children)

  const rootX = 88
  const childX = 460
  const width = 640

  let y = 20
  const positioned: { node: RelationNode; y: number }[] = []
  const groupHeaders: { label: string; y: number }[] = []
  for (const [category, groupNodes] of groups) {
    groupHeaders.push({ label: category, y })
    y += 18
    for (const node of groupNodes) {
      positioned.push({ node, y: y + ROW_HEIGHT / 2 - 9 })
      y += ROW_HEIGHT
    }
    y += GROUP_GAP
  }
  const height = Math.max(y, 120)
  const rootY = height / 2

  function go(node: RelationNode) {
    router.push(`${node.type === 'person' ? '/people' : '/artists'}/${node.id}`)
  }

  if (!center) return null

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full select-none" style={{ maxHeight: 640 }}>
      <g>
        {positioned.map(({ node, y: ny }) => {
          const color = node.category ? colorForCategory(node.category) : 'rgba(255,255,255,0.4)'
          return (
            <path
              key={`edge-${node.id}`}
              d={elbowPath(rootX + NODE_R_ROOT, rootY, childX - NODE_R, ny + 9)}
              fill="none"
              stroke={color}
              strokeOpacity={0.45}
              strokeWidth={1.5}
            />
          )
        })}
      </g>

      <g>
        {groupHeaders.map((h) => (
          <text
            key={h.label}
            x={childX}
            y={h.y + 4}
            textAnchor="middle"
            fill={colorForCategory(h.label)}
            fontSize={11}
            fontWeight={700}
          >
            {h.label}
          </text>
        ))}
      </g>

      <g onClick={() => go(center)} className="cursor-pointer">
        <circle cx={rootX} cy={rootY} r={NODE_R_ROOT} fill="#fff" />
        <text x={rootX} y={rootY + 24} textAnchor="middle" fill="#fff" fontSize={13} fontWeight={700}>
          {center.name}
        </text>
      </g>

      <g>
        {positioned.map(({ node, y: ny }) => {
          const color = node.category ? colorForCategory(node.category) : 'rgba(255,255,255,0.6)'
          const edge = edges.find(
            (e) => (e.source === node.id || e.target === node.id) && (e.source === centerId || e.target === centerId)
          )
          return (
            <g key={node.id} onClick={() => go(node)} className="cursor-pointer">
              <circle
                cx={childX}
                cy={ny + 9}
                r={NODE_R}
                fill="rgba(255,255,255,0.14)"
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray={node.type === 'person' ? '2 2' : undefined}
              />
              <text x={childX + 14} y={ny + 13} fill="rgba(255,255,255,0.85)" fontSize={12}>
                {node.name}
              </text>
              {edge?.label && (
                <text x={childX + 14} y={ny + 27} fill="rgba(255,255,255,0.35)" fontSize={10}>
                  {edge.label}
                </text>
              )}
            </g>
          )
        })}
      </g>
    </svg>
  )
}

/** 中心の無い全体ハブ用: ジャンルごとに列を固定し、列内に縦並び。 */
function CategoryColumns({ nodes, edges }: { nodes: RelationNode[]; edges: RelationEdge[] }) {
  const router = useRouter()
  const groups = groupByCategory(nodes)

  const colWidth = 168
  const colPadX = 84
  const width = Math.max(groups.length * colWidth + colPadX, 480)

  const posById = new Map<string, { x: number; y: number; category: string }>()
  const groupInfo: { label: string; x: number; count: number }[] = []
  groups.forEach(([category, groupNodes], i) => {
    const x = colPadX + i * colWidth
    groupInfo.push({ label: category, x, count: groupNodes.length })
    groupNodes.forEach((node, j) => {
      posById.set(node.id, { x, y: 46 + j * ROW_HEIGHT, category })
    })
  })
  const maxRows = Math.max(...groups.map(([, g]) => g.length), 1)
  const height = Math.max(46 + maxRows * ROW_HEIGHT + 20, 200)

  function go(node: RelationNode) {
    router.push(`${node.type === 'person' ? '/people' : '/artists'}/${node.id}`)
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full select-none" style={{ maxHeight: 640 }}>
      <g>
        {groupInfo.map((g) => (
          <rect
            key={g.label}
            x={g.x - 60}
            y={20}
            width={120}
            height={g.count * ROW_HEIGHT + 20}
            rx={10}
            fill={colorForCategory(g.label)}
            fillOpacity={0.06}
            stroke={colorForCategory(g.label)}
            strokeOpacity={0.25}
          />
        ))}
      </g>
      <g>
        {groupInfo.map((g) => (
          <text key={g.label} x={g.x} y={14} textAnchor="middle" fill={colorForCategory(g.label)} fontSize={11} fontWeight={700}>
            {g.label}
          </text>
        ))}
      </g>
      <g>
        {edges.map((e, i) => {
          const s = posById.get(e.source)
          const t = posById.get(e.target)
          if (!s || !t) return null
          if (s.x === t.x && s.y === t.y) return null
          return (
            <path
              key={i}
              d={elbowPath(s.x, s.y + 9, t.x, t.y + 9)}
              fill="none"
              stroke="rgba(255,255,255,0.25)"
              strokeWidth={1.25}
              strokeDasharray={e.style === 'dotted' ? '4 4' : undefined}
            >
              {e.label && <title>{e.label}</title>}
            </path>
          )
        })}
      </g>
      <g>
        {nodes.map((node) => {
          const pos = posById.get(node.id)
          if (!pos) return null
          const color = node.category ? colorForCategory(node.category) : 'rgba(255,255,255,0.6)'
          return (
            <g key={node.id} onClick={() => go(node)} className="cursor-pointer">
              <circle
                cx={pos.x}
                cy={pos.y + 9}
                r={NODE_R}
                fill="rgba(255,255,255,0.14)"
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray={node.type === 'person' ? '2 2' : undefined}
              />
              <text x={pos.x} y={pos.y + 27} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize={11}>
                {node.name}
              </text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}

export default function RelationGraph({
  nodes,
  edges,
  centerId,
}: {
  nodes: RelationNode[]
  edges: RelationEdge[]
  centerId?: string
}) {
  const categories = Array.from(new Set(nodes.map((n) => n.category ?? UNCATEGORIZED)))

  if (nodes.length === 0) {
    return <p className="py-16 text-center text-sm text-white/40">まだ相関データがありません。</p>
  }

  return (
    <div>
      {centerId ? (
        <EgoTree nodes={nodes} edges={edges} centerId={centerId} />
      ) : (
        <CategoryColumns nodes={nodes} edges={edges} />
      )}

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-white/10 px-2 py-3 text-xs text-white/60">
          {categories.map((category) => (
            <span key={category} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: colorForCategory(category) }}
              />
              {category}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
