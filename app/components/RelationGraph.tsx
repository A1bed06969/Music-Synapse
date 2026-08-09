'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceX,
  forceY,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { polygonHull } from 'd3-polygon'
import { line, curveCatmullRomClosed } from 'd3-shape'

export type RelationNode = { id: string; name: string; category?: string | null; type?: 'artist' | 'person' }
export type RelationEdge = {
  source: string
  target: string
  style: 'solid' | 'dotted'
  label?: string | null
}

type SimNode = RelationNode & SimulationNodeDatum
type SimLink = SimulationLinkDatum<SimNode> & { style: 'solid' | 'dotted'; label?: string | null }

const WIDTH = 800
const HEIGHT = 560
const CLUSTER_RADIUS = Math.min(WIDTH, HEIGHT) * 0.32
const BLOB_PAD = 44

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

function clusterAnchors(categories: string[]) {
  const anchors = new Map<string, { x: number; y: number }>()
  categories.forEach((category, i) => {
    const angle = (i / categories.length) * Math.PI * 2 - Math.PI / 2
    anchors.set(category, {
      x: WIDTH / 2 + CLUSTER_RADIUS * Math.cos(angle),
      y: HEIGHT / 2 + CLUSTER_RADIUS * Math.sin(angle),
    })
  })
  return anchors
}

const blobLine = line<[number, number]>()
  .curve(curveCatmullRomClosed.alpha(0.9))
  .x((d) => d[0])
  .y((d) => d[1])

function blobPath(nodes: SimNode[]) {
  // ノード周囲に円状の点を足してからハル(外殻)を取ることで、
  // 1〜2件しかないカテゴリーでも自然な余白付きの塊として描ける
  const points: [number, number][] = []
  for (const node of nodes) {
    if (node.x == null || node.y == null) continue
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2
      points.push([node.x + Math.cos(angle) * BLOB_PAD, node.y + Math.sin(angle) * BLOB_PAD])
    }
  }
  const hull = polygonHull(points)
  if (!hull) return null
  return blobLine(hull)
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
  const router = useRouter()
  const [simNodes, setSimNodes] = useState<SimNode[]>([])
  const [simLinks, setSimLinks] = useState<SimLink[]>([])
  const simulationRef = useRef<Simulation<SimNode, SimLink> | null>(null)
  const draggingRef = useRef<{ node: SimNode; moved: boolean } | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const categories = Array.from(
    new Set(nodes.map((n) => n.category).filter((c): c is string => Boolean(c)))
  )

  useEffect(() => {
    const nodesCopy: SimNode[] = nodes.map((n) => ({ ...n }))
    const linksCopy: SimLink[] = edges.map((e) => ({ ...e }))

    const centerNode = centerId ? nodesCopy.find((n) => n.id === centerId) : undefined
    if (centerNode) {
      centerNode.fx = WIDTH / 2
      centerNode.fy = HEIGHT / 2
    }

    const anchors = clusterAnchors(categories)

    const simulation = forceSimulation<SimNode>(nodesCopy)
      .force(
        'link',
        forceLink<SimNode, SimLink>(linksCopy)
          .id((d) => d.id)
          .distance(110)
      )
      .force('charge', forceManyBody().strength(-260))
      .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))
      .force('collide', forceCollide(38))
      .force(
        'x',
        forceX<SimNode>((d) => (d.category ? (anchors.get(d.category)?.x ?? WIDTH / 2) : WIDTH / 2)).strength(
          (d) => (d.category ? 0.15 : 0.02)
        )
      )
      .force(
        'y',
        forceY<SimNode>((d) => (d.category ? (anchors.get(d.category)?.y ?? HEIGHT / 2) : HEIGHT / 2)).strength(
          (d) => (d.category ? 0.15 : 0.02)
        )
      )
      .on('tick', () => {
        setSimNodes([...nodesCopy])
      })

    simulationRef.current = simulation
    setSimLinks(linksCopy)

    return () => {
      simulation.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, centerId])

  function handlePointerDown(e: React.PointerEvent, node: SimNode) {
    if (node.id === centerId) return
    e.stopPropagation()
    draggingRef.current = { node, moved: false }
    simulationRef.current?.alphaTarget(0.3).restart()

    function toSvgPoint(clientX: number, clientY: number) {
      const svg = svgRef.current
      if (!svg) return null
      const rect = svg.getBoundingClientRect()
      return {
        x: ((clientX - rect.left) / rect.width) * WIDTH,
        y: ((clientY - rect.top) / rect.height) * HEIGHT,
      }
    }

    function handleMove(ev: PointerEvent) {
      const point = toSvgPoint(ev.clientX, ev.clientY)
      if (!point || !draggingRef.current) return
      draggingRef.current.node.fx = point.x
      draggingRef.current.node.fy = point.y
      draggingRef.current.moved = true
    }

    function handleUp() {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      simulationRef.current?.alphaTarget(0)
      const current = draggingRef.current
      draggingRef.current = null
      if (!current) return
      current.node.fx = null
      current.node.fy = null
      if (!current.moved) {
        const path = current.node.type === 'person' ? '/people' : '/artists'
        router.push(`${path}/${current.node.id}`)
      }
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  if (nodes.length === 0) {
    return <p className="py-16 text-center text-sm text-white/40">まだ相関データがありません。</p>
  }

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full touch-none select-none"
        style={{ maxHeight: HEIGHT }}
      >
        <g>
          {categories.map((category) => {
            const nodesInCategory = simNodes.filter((n) => n.category === category)
            const path = blobPath(nodesInCategory)
            if (!path) return null
            const color = colorForCategory(category)
            const centroidX =
              nodesInCategory.reduce((sum, n) => sum + (n.x ?? 0), 0) / nodesInCategory.length
            const centroidY =
              Math.min(...nodesInCategory.map((n) => n.y ?? HEIGHT)) - BLOB_PAD - 10

            return (
              <g key={category}>
                <path d={path} fill={color} fillOpacity={0.12} stroke={color} strokeOpacity={0.4} strokeWidth={1.5} />
                <text x={centroidX} y={centroidY} textAnchor="middle" fill={color} fontSize={12} fontWeight={700}>
                  {category}
                </text>
              </g>
            )
          })}
        </g>

        <g>
          {simLinks.map((link, i) => {
            const source = typeof link.source === 'object' ? link.source : undefined
            const target = typeof link.target === 'object' ? link.target : undefined
            if (!source || !target || source.x == null || target.x == null || target.y == null || source.y == null) {
              return null
            }
            return (
              <line
                key={i}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke="rgba(255,255,255,0.25)"
                strokeWidth={1.5}
                strokeDasharray={link.style === 'dotted' ? '4 4' : undefined}
              >
                {link.label && <title>{link.label}</title>}
              </line>
            )
          })}
        </g>
        <g>
          {simNodes.map((node) => {
            if (node.x == null || node.y == null) return null
            const isCenter = node.id === centerId
            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                onPointerDown={(e) => handlePointerDown(e, node)}
                className={isCenter ? 'cursor-default' : 'cursor-pointer'}
              >
                <circle
                  r={isCenter ? 26 : 18}
                  fill={isCenter ? '#fff' : 'rgba(255,255,255,0.14)'}
                  stroke="rgba(255,255,255,0.4)"
                  strokeWidth={1}
                  strokeDasharray={node.type === 'person' ? '3 3' : undefined}
                />
                <text
                  y={isCenter ? 42 : 32}
                  textAnchor="middle"
                  fill={isCenter ? '#fff' : 'rgba(255,255,255,0.7)'}
                  fontSize={isCenter ? 13 : 11}
                  fontWeight={isCenter ? 700 : 400}
                >
                  {node.name}
                </text>
              </g>
            )
          })}
        </g>
      </svg>

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
