'use client'

import Link from 'next/link'
import { useState } from 'react'
import { PREFECTURE_COORDS } from '@/utils/prefectures'

export type PrefectureEntry = {
  stationName: string
  targetLabel: string
  targetHref: string | null
  musicType: 'DOMESTIC' | 'OVERSEAS'
}

export type PrefectureMapData = {
  prefecture: string
  mediaCount: number
  entries: PrefectureEntry[]
}

const MUSIC_TYPE_LABEL: Record<string, string> = {
  DOMESTIC: '邦楽',
  OVERSEAS: '洋楽',
}

export default function PrefectureMap({ data }: { data: PrefectureMapData[] }) {
  const [selectedPref, setSelectedPref] = useState<string | null>(null)

  const dataByPrefecture = new Map(data.map((d) => [d.prefecture, d]))
  const selected = selectedPref ? dataByPrefecture.get(selectedPref) : null

  if (data.length === 0) {
    return <p className="text-sm text-white/40">この月は都道府県データがありません。</p>
  }

  return (
    <div>
      <svg viewBox="12 2 76 74" className="w-full max-w-md select-none" style={{ maxHeight: 420 }}>
        {PREFECTURE_COORDS.map((coord) => {
          const entry = dataByPrefecture.get(coord.name)
          if (!entry) return null
          const isSelected = selectedPref === coord.name

          return (
            <g
              key={coord.name}
              transform={`translate(${coord.x}, ${coord.y})`}
              onClick={() => setSelectedPref(isSelected ? null : coord.name)}
              className="cursor-pointer"
            >
              <circle
                r={isSelected ? 2.6 : 2}
                fill={isSelected ? '#ffffff' : 'rgba(255,255,255,0.5)'}
                stroke="rgba(255,255,255,0.6)"
                strokeWidth={0.3}
              />
              <text x={0} y={-3} textAnchor="middle" fontSize={2.4} fill="rgba(255,255,255,0.7)">
                {entry.mediaCount}
              </text>
            </g>
          )
        })}
      </svg>

      {selected && (
        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <p className="text-sm font-semibold">{selected.prefecture}の選出局</p>
          <ul className="mt-3 divide-y divide-white/10">
            {selected.entries.map((entry, i) => (
              <li key={i} className="flex items-center justify-between gap-4 py-2 text-sm">
                <div>
                  {entry.targetHref ? (
                    <Link href={entry.targetHref} className="font-medium hover:opacity-70">
                      {entry.targetLabel}
                    </Link>
                  ) : (
                    <span className="font-medium">{entry.targetLabel}</span>
                  )}
                  <p className="text-xs text-white/40">{entry.stationName}</p>
                </div>
                <span className="shrink-0 text-xs text-white/30">{MUSIC_TYPE_LABEL[entry.musicType]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
