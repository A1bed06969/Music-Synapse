'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export type RelationNode = {
  id: string
  name: string
  category?: string | null
  type?: 'artist' | 'person'
  imageUrl?: string | null
}
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
/** 同じ列内のノード同士を繋ぐ経路。列の外側に迂回することで、
 * 経路上に他の無関係なノードが乗って誤解を招くことを避ける。 */
function sameColumnBumpPath(x: number, sy: number, ty: number, bumpOffset: number): string {
  const bx = x + bumpOffset
  return `M ${x},${sy} H ${bx} V ${ty} H ${x}`
}
function sameColumnBumpMidpoint(x: number, sy: number, ty: number, bumpOffset: number) {
  return { x: x + bumpOffset, y: (sy + ty) / 2 }
}

/** 列をまたぐノード同士を繋ぐ経路。まず列と列の間の余白(ガター)へ横に
 * 逃がしてから上部の専用レーンへ上り下りする。これにより、同じ列の他の
 * ノードの真上を線が通過して誤解を招くことを避ける。 */
function highwayPath(sx: number, sy: number, tx: number, ty: number, laneY: number, gutterOffset: number): string {
  const gsx = sx + gutterOffset
  const gtx = tx + gutterOffset
  return `M ${sx},${sy} H ${gsx} V ${laneY} H ${gtx} V ${ty} H ${tx}`
}
function highwayMidpoint(sx: number, tx: number, laneY: number, gutterOffset: number) {
  return { x: (sx + gutterOffset + tx + gutterOffset) / 2, y: laneY }
}

// 1アーティストあたりの表示領域(以前より一回り小さくして密度を上げている)
const NODE_R = 42
const NODE_R_ROOT = 50
const ROW_HEIGHT = 155
const LABEL_GAP = 20
const NAME_FONT_SIZE = 13
const HEADER_FONT_SIZE = 14

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?'
}

/** 丸い顔写真アバター。画像が無い場合は頭文字の丸バッジで代用する。 */
function Avatar({
  node,
  cx,
  cy,
  r,
  strokeColor,
  opacity = 1,
}: {
  node: RelationNode
  cx: number
  cy: number
  r: number
  strokeColor: string
  opacity?: number
}) {
  const clipId = `avatar-clip-${node.id}`
  return (
    <g opacity={opacity}>
      {node.imageUrl ? (
        <>
          <clipPath id={clipId}>
            <circle cx={cx} cy={cy} r={r} />
          </clipPath>
          <image
            href={node.imageUrl}
            x={cx - r}
            y={cy - r}
            width={r * 2}
            height={r * 2}
            clipPath={`url(#${clipId})`}
            preserveAspectRatio="xMidYMid slice"
          />
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={strokeColor} strokeWidth={2.5} />
        </>
      ) : (
        <>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="rgba(255,255,255,0.12)"
            stroke={strokeColor}
            strokeWidth={2.5}
            strokeDasharray={node.type === 'person' ? '5 4' : undefined}
          />
          <text x={cx} y={cy + r * 0.32} textAnchor="middle" fontSize={r * 0.9} fill="rgba(255,255,255,0.6)" fontWeight={700}>
            {initial(node.name)}
          </text>
        </>
      )}
    </g>
  )
}

/** 線の上に乗せる小さな関係ラベル。背景を敷いて可読性を確保する。 */
function EdgeLabel({ x, y, text, active }: { x: number; y: number; text: string; active: boolean }) {
  const width = Math.min(Math.max(text.length * 7.2 + 12, 26), 220)
  return (
    <g opacity={active ? 0.95 : 0.3} pointerEvents="none">
      <rect x={x - width / 2} y={y - 11} width={width} height={22} rx={5} fill="#0b0b0e" fillOpacity={0.88} />
      <text x={x} y={y + 5} textAnchor="middle" fontSize={13} fill="rgba(255,255,255,0.8)">
        {text}
      </text>
    </g>
  )
}

/** 矢印マーカーの定義。実線(在籍/制作/コラボ)にのみ向きを表示する。 */
function ArrowDefs() {
  return (
    <defs>
      <marker id="rg-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 Z" fill="rgba(255,255,255,0.4)" />
      </marker>
      <marker id="rg-arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 Z" fill="rgba(255,255,255,0.95)" />
      </marker>
    </defs>
  )
}

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

const NO_RELATION = 'つながりなし'

/** 線で繋がっているノード同士を1グループ(接続成分)にまとめる。ジャンルを
 * 無視して「実際に線があるかどうか」だけで分けるので、リレーションモードで
 * 同じ塊のノードが同じ列に収まり、線を素直に引ける。線が1本も無いノードは
 * 最後に「つながりなし」としてまとめる。 */
function groupByConnection(nodes: RelationNode[], edges: RelationEdge[]) {
  const adjacency = new Map<string, string[]>()
  for (const n of nodes) adjacency.set(n.id, [])
  for (const e of edges) {
    if (!adjacency.has(e.source) || !adjacency.has(e.target) || e.source === e.target) continue
    adjacency.get(e.source)!.push(e.target)
    adjacency.get(e.target)!.push(e.source)
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const visited = new Set<string>()
  const clusters: RelationNode[][] = []
  for (const n of nodes) {
    if (visited.has(n.id)) continue
    visited.add(n.id)
    const stack = [n.id]
    const members: RelationNode[] = []
    while (stack.length > 0) {
      const id = stack.pop()!
      members.push(byId.get(id)!)
      for (const neighborId of adjacency.get(id) ?? []) {
        if (visited.has(neighborId)) continue
        visited.add(neighborId)
        stack.push(neighborId)
      }
    }
    clusters.push(members)
  }

  const connected = clusters.filter((c) => c.length > 1).sort((a, b) => b.length - a.length)
  const isolated = clusters.filter((c) => c.length === 1).flat()

  const groups: [string, RelationNode[]][] = connected.map((members, i) => [`グループ${i + 1}`, members])
  if (isolated.length > 0) groups.push([NO_RELATION, isolated])
  return groups
}

/** 中心アーティスト1人から右へ枝が伸びる木構造レイアウト。1行=1相手を厳守する
 * ことで、相手が多くても線同士が重ならない。onAvatarClickを渡すと、アイコン
 * クリック時にページ遷移の代わりにそのコールバックを呼ぶ(相関図内での
 * 再フォーカスに使う)。名前クリックは常にページ遷移する。 */
function EgoTree({
  nodes,
  edges,
  centerId,
  onAvatarClick,
}: {
  nodes: RelationNode[]
  edges: RelationEdge[]
  centerId: string
  onAvatarClick?: (node: RelationNode) => void
}) {
  const router = useRouter()
  const center = nodes.find((n) => n.id === centerId)
  const children = nodes.filter((n) => n.id !== centerId)
  const groups = groupByCategory(children)

  const rootX = 115
  const childX = 580
  const width = 900

  let y = 50
  const positioned: { node: RelationNode; cy: number }[] = []
  const groupHeaders: { label: string; y: number }[] = []
  for (const [category, groupNodes] of groups) {
    groupHeaders.push({ label: category, y: y + 6 })
    y += 40
    for (const node of groupNodes) {
      positioned.push({ node, cy: y + NODE_R })
      y += ROW_HEIGHT
    }
  }
  const height = Math.max(y, NODE_R_ROOT * 2 + 100)
  const rootY = height / 2

  function go(node: RelationNode) {
    router.push(`${node.type === 'person' ? '/people' : '/artists'}/${node.id}`)
  }

  // 在籍期間が複数回に分かれている等、中心アーティストとの間に複数の
  // リレーションが存在する場合は最初の1件だけでなく全て拾い、まとめて表示する
  function relatedEdges(nodeId: string) {
    return edges.filter(
      (e) => (e.source === nodeId || e.target === nodeId) && (e.source === centerId || e.target === centerId)
    )
  }
  function combinedLabel(nodeId: string): string | null {
    const labels = relatedEdges(nodeId)
      .map((e) => e.label)
      .filter((l): l is string => Boolean(l))
    return labels.length > 0 ? labels.join(' / ') : null
  }
  function primaryEdgeStyle(nodeId: string): 'solid' | 'dotted' | undefined {
    return relatedEdges(nodeId)[0]?.style
  }

  if (!center) return null

  return (
    <div className="overflow-auto" style={{ maxHeight: 720 }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="select-none">
        <ArrowDefs />
        <g>
          {positioned.map(({ node, cy }) => {
            const color = node.category ? colorForCategory(node.category) : 'rgba(255,255,255,0.4)'
            return (
              <path
                key={`edge-${node.id}`}
                d={elbowPath(rootX + NODE_R_ROOT, rootY, childX - NODE_R, cy)}
                fill="none"
                stroke={color}
                strokeOpacity={0.45}
                strokeWidth={2}
                markerEnd={primaryEdgeStyle(node.id) === 'solid' ? 'url(#rg-arrow)' : undefined}
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
              fontSize={HEADER_FONT_SIZE}
              fontWeight={700}
            >
              {h.label}
            </text>
          ))}
        </g>

        <g onClick={() => (onAvatarClick ? onAvatarClick(center) : go(center))} className="cursor-pointer">
          <Avatar node={center} cx={rootX} cy={rootY} r={NODE_R_ROOT} strokeColor="#fff" />
        </g>
        <text
          x={rootX}
          y={rootY + NODE_R_ROOT + 24}
          textAnchor="middle"
          fill="#fff"
          fontSize={17}
          fontWeight={700}
          onClick={() => go(center)}
          className="cursor-pointer hover:underline"
        >
          {center.name}
        </text>

        <g>
          {positioned.map(({ node, cy }) => {
            const color = node.category ? colorForCategory(node.category) : 'rgba(255,255,255,0.6)'
            const label = combinedLabel(node.id)
            return (
              <g key={node.id}>
                <g onClick={() => (onAvatarClick ? onAvatarClick(node) : go(node))} className="cursor-pointer">
                  <Avatar node={node} cx={childX} cy={cy} r={NODE_R} strokeColor={color} />
                </g>
                <text
                  x={childX + NODE_R + 14}
                  y={cy - 2}
                  fill="rgba(255,255,255,0.85)"
                  fontSize={NAME_FONT_SIZE}
                  onClick={() => go(node)}
                  className="cursor-pointer hover:underline"
                >
                  {node.name}
                </text>
                {label && (
                  <text x={childX + NODE_R + 14} y={cy + 18} fill="rgba(255,255,255,0.4)" fontSize={12}>
                    {label}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}

type NodePos = { x: number; cy: number; category: string }

/** 中心の無い全体ハブ用: グループ(ジャンル、または接続成分)ごとに列を
 * 固定し、列内に縦一列で並べる。同じ列/違う列をまたぐ線は、それぞれ列の
 * 外側や上部の専用レーンを経由させ、無関係なノードの真上を通らないように
 * する。ノードをクリックすると、そのアーティストと直接つながる相手だけに
 * 絞り込んで再レイアウトする(アーティスト軸表示)。もう一度同じノードを
 * クリックするか「全体表示に戻す」で全件表示に戻る。 */
function ColumnLayout({
  nodes,
  edges,
  hubMode,
}: {
  nodes: RelationNode[]
  edges: RelationEdge[]
  hubMode: HubMode
}) {
  const router = useRouter()
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const focusedNode = focusedId ? (nodes.find((n) => n.id === focusedId) ?? null) : null

  function toggleFocus(id: string) {
    setFocusedId((prev) => (prev === id ? null : id))
  }

  // フォーカス中は「選択アーティスト+直接つながる相手」だけの木構造(EgoTree)に
  // 切り替える。列をまたぐ線を1本の共有レーンに束ねる通常レイアウトは、
  // 1つのハブから多方向へ線が伸びるこのケースだと重なって読めなくなるため。
  if (focusedNode) {
    return (
      <div>
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs text-white/60">
          <span>
            🔍 <span className="text-white/85">{focusedNode.name}</span> の相関のみ表示中
          </span>
          <button
            type="button"
            onClick={() => setFocusedId(null)}
            className="rounded border border-white/15 px-2 py-0.5 text-white/70 hover:bg-white/10"
          >
            ✕ 全体表示に戻す
          </button>
        </div>
        <EgoTree nodes={nodes} edges={edges} centerId={focusedNode.id} onAvatarClick={(n) => toggleFocus(n.id)} />
      </div>
    )
  }

  const groups = hubMode === 'genre' ? groupByCategory(nodes) : groupByConnection(nodes, edges)

  const colWidth = 270
  const colPadX = 140
  const width = Math.max(groups.length * colWidth + colPadX, 400)
  const boxHalfWidth = 85
  const bumpOffset = 68
  const gutterOffset = 105

  // まずxとカテゴリだけ確定させる(yは後で決める。列をまたぐ線の本数が
  // 分かってから、上部の迂回レーン分だけノード行を下にずらす必要があるため)
  const columnXById = new Map<string, number>()
  const groupInfo: { label: string; x: number; count: number }[] = []
  groups.forEach(([category, groupNodes], i) => {
    const x = colPadX + i * colWidth
    groupInfo.push({ label: category, x, count: groupNodes.length })
    groupNodes.forEach((node) => columnXById.set(node.id, x))
  })

  const validEdges = edges.filter(
    (e) => columnXById.has(e.source) && columnXById.has(e.target) && e.source !== e.target
  )
  const crossColumnEdges = validEdges.filter((e) => columnXById.get(e.source) !== columnXById.get(e.target))

  const HEADER_Y = 24
  const LANE_GAP = 10
  const highwayTop = HEADER_Y + 30
  const highwayHeight = Math.max(crossColumnEdges.length * LANE_GAP, 0)
  const rowsTop = highwayTop + highwayHeight + NODE_R + 30

  const posById = new Map<string, NodePos>()
  groups.forEach(([category, groupNodes], i) => {
    const x = colPadX + i * colWidth
    groupNodes.forEach((node, j) => {
      posById.set(node.id, { x, cy: rowsTop + j * ROW_HEIGHT, category })
    })
  })
  const maxRows = Math.max(...groupInfo.map((g) => g.count), 1)
  const height = Math.max(rowsTop + (maxRows - 1) * ROW_HEIGHT + NODE_R + 60, 260)

  function go(node: RelationNode) {
    router.push(`${node.type === 'person' ? '/people' : '/artists'}/${node.id}`)
  }

  return (
    <div className="overflow-auto" style={{ maxHeight: 720 }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="select-none">
        <ArrowDefs />
        <g>
          {groupInfo.map((g) => (
            <rect
              key={g.label}
              x={g.x - boxHalfWidth}
              y={rowsTop - NODE_R - 40}
              width={boxHalfWidth * 2}
              height={(g.count - 1) * ROW_HEIGHT + NODE_R * 2 + 60}
              rx={14}
              fill={colorForCategory(g.label)}
              fillOpacity={0.06}
              stroke={colorForCategory(g.label)}
              strokeOpacity={0.25}
            />
          ))}
        </g>
        <g>
          {groupInfo.map((g) => (
            <text key={g.label} x={g.x} y={HEADER_Y} textAnchor="middle" fill={colorForCategory(g.label)} fontSize={HEADER_FONT_SIZE} fontWeight={700}>
              {g.label}
            </text>
          ))}
        </g>
        <g>
          {validEdges.map((e, i) => {
            const s = posById.get(e.source)
            const t = posById.get(e.target)
            if (!s || !t) return null
            if (s.x !== t.x) return null // 列またぎは下の専用レーンで描画
            // 経路が同じ列の他の無関係なノードの真上を通らないよう、列の外側へ迂回する
            const mid = sameColumnBumpMidpoint(s.x, s.cy, t.cy, bumpOffset)
            return (
              <g key={i}>
                <path
                  d={sameColumnBumpPath(s.x, s.cy, t.cy, bumpOffset)}
                  fill="none"
                  stroke="rgba(255,255,255,0.25)"
                  strokeWidth={1.75}
                  strokeDasharray={e.style === 'dotted' ? '5 5' : undefined}
                  markerEnd={e.style === 'solid' ? 'url(#rg-arrow)' : undefined}
                />
                {e.label && <EdgeLabel x={mid.x} y={mid.y} text={e.label} active={false} />}
              </g>
            )
          })}
        </g>
        <g>
          {crossColumnEdges.map((e, laneIndex) => {
            const s = posById.get(e.source)
            const t = posById.get(e.target)
            if (!s || !t) return null
            // 列をまたぐ経路は、途中の列のノードの上を通らないよう、
            // 全ノードより上の専用レーンを経由させる(線ごとに高さをずらす)
            const laneY = highwayTop + laneIndex * LANE_GAP
            const mid = highwayMidpoint(s.x, t.x, laneY, gutterOffset)
            return (
              <g key={`cross-${laneIndex}`}>
                <path
                  d={highwayPath(s.x, s.cy, t.x, t.cy, laneY, gutterOffset)}
                  fill="none"
                  stroke="rgba(255,255,255,0.25)"
                  strokeWidth={1.75}
                  strokeDasharray={e.style === 'dotted' ? '5 5' : undefined}
                  markerEnd={e.style === 'solid' ? 'url(#rg-arrow)' : undefined}
                />
                {e.label && <EdgeLabel x={mid.x} y={mid.y} text={e.label} active={false} />}
              </g>
            )
          })}
        </g>
        <g>
          {nodes.map((node) => {
            const pos = posById.get(node.id)
            if (!pos) return null
            const color = node.category ? colorForCategory(node.category) : 'rgba(255,255,255,0.6)'
            return (
              <g key={node.id}>
                <g onClick={() => toggleFocus(node.id)} className="cursor-pointer">
                  <Avatar node={node} cx={pos.x} cy={pos.cy} r={NODE_R} strokeColor={color} />
                </g>
                <text
                  x={pos.x}
                  y={pos.cy + NODE_R + LABEL_GAP}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.85)"
                  fontSize={NAME_FONT_SIZE}
                  onClick={() => go(node)}
                  className="cursor-pointer hover:underline"
                >
                  {node.name}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}

type HubMode = 'genre' | 'relation'

export default function RelationGraph({
  nodes,
  edges,
  centerId,
}: {
  nodes: RelationNode[]
  edges: RelationEdge[]
  centerId?: string
}) {
  const [hubMode, setHubMode] = useState<HubMode>('genre')
  const categories = Array.from(new Set(nodes.map((n) => n.category ?? UNCATEGORIZED)))

  if (nodes.length === 0) {
    return <p className="py-16 text-center text-sm text-white/40">まだ相関データがありません。</p>
  }

  return (
    <div>
      {!centerId && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 p-2">
          <div className="flex gap-1">
            {(
              [
                ['genre', 'ジャンル'],
                ['relation', 'リレーション'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setHubMode(value)}
                className={`rounded px-3 py-1 text-xs ${
                  hubMode === value ? 'bg-white text-black' : 'text-white/60 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="px-1 text-[11px] text-white/30">アイコンクリックでアーティスト軸に絞り込み / 名前クリックで詳細へ</p>
        </div>
      )}

      {centerId ? (
        <EgoTree nodes={nodes} edges={edges} centerId={centerId} />
      ) : (
        <ColumnLayout nodes={nodes} edges={edges} hubMode={hubMode} />
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
