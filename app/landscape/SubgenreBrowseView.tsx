'use client'

import Link from 'next/link'

export type SubgenreTile = {
  genreId: string
  name: string
  artistCount: number
  href: string
}

const VIEW_W = 1000
const VIEW_H = 720
const CENTER_X = VIEW_W / 2
const CENTER_Y = VIEW_H / 2
const RADIUS = 280
const MIN_R = 30
const MAX_R = 70

/** 子ジャンルが持つアーティスト数を円の大きさにマッピングする(多いほど大きい)。 */
function radiusForCount(count: number, maxCount: number): number {
  if (maxCount <= 0) return MIN_R
  const ratio = Math.sqrt(count / maxCount)
  return MIN_R + ratio * (MAX_R - MIN_R)
}

export default function SubgenreBrowseView({
  currentName,
  tiles,
}: {
  currentName: string
  tiles: SubgenreTile[]
}) {
  const maxCount = Math.max(1, ...tiles.map((t) => t.artistCount))

  return (
    <div className="w-full overflow-hidden rounded-lg border border-white/10 bg-black">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="h-[70vh] w-full" role="img" aria-label={`${currentName}のサブジャンル一覧`}>
        <text x={CENTER_X} y={CENTER_Y} textAnchor="middle" dominantBaseline="middle" className="fill-white/70 text-sm font-bold">
          {currentName}
        </text>
        {tiles.map((tile, i) => {
          const angle = (2 * Math.PI * i) / tiles.length - Math.PI / 2
          const x = CENTER_X + RADIUS * Math.cos(angle)
          const y = CENTER_Y + RADIUS * Math.sin(angle)
          const r = radiusForCount(tile.artistCount, maxCount)
          return (
            <Link key={tile.genreId} href={tile.href} className="cursor-pointer">
              <g>
                <line x1={CENTER_X} y1={CENTER_Y} x2={x} y2={y} className="stroke-white/10" strokeWidth={1} />
                <circle cx={x} cy={y} r={r} className="fill-white/10 stroke-white/25 transition hover:fill-white/20" strokeWidth={1} />
                <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="fill-white/80 text-[11px]">
                  {tile.name}
                </text>
                <text x={x} y={y + r + 14} textAnchor="middle" className="fill-white/30 text-[10px]">
                  {tile.artistCount}組
                </text>
              </g>
            </Link>
          )
        })}
      </svg>
    </div>
  )
}
