'use client'

import Link from 'next/link'
import { useState } from 'react'
import { PREFECTURE_SHAPES, JAPAN_MAP_VIEWBOX, JAPAN_MAP_OUTER_TRANSFORM, JAPAN_MAP_GROUP_TRANSFORM } from '@/utils/japan-map'

export type PrefectureEntry = {
  stationName: string
  targetLabel: string
  targetHref: string | null
  musicType: 'DOMESTIC' | 'OVERSEAS'
  artworkUrl: string | null
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

function groupByStation(entries: PrefectureEntry[]) {
  const groups: { stationName: string; entries: PrefectureEntry[] }[] = []
  for (const entry of entries) {
    const last = groups[groups.length - 1]
    if (last && last.stationName === entry.stationName) {
      last.entries.push(entry)
    } else {
      groups.push({ stationName: entry.stationName, entries: [entry] })
    }
  }
  return groups
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
      <svg viewBox={JAPAN_MAP_VIEWBOX} className="w-full max-w-2xl select-none" style={{ maxHeight: 640 }}>
        <g transform={JAPAN_MAP_OUTER_TRANSFORM}>
          <g transform={JAPAN_MAP_GROUP_TRANSFORM}>
            {PREFECTURE_SHAPES.map((pref) => {
              const entry = dataByPrefecture.get(pref.name)
              const isSelected = selectedPref === pref.name
              const fill = isSelected
                ? 'rgba(255,255,255,0.9)'
                : entry
                  ? 'rgba(255,255,255,0.45)'
                  : 'rgba(255,255,255,0.05)'

              let label: string | null = null
              if (entry) {
                const stationNames = Array.from(new Set(entry.entries.map((e) => e.stationName)))
                label = stationNames.length > 1 ? `${stationNames[0]} 他${stationNames.length - 1}局` : stationNames[0]
              }

              return (
                <g
                  key={pref.name}
                  transform={pref.transform}
                  onClick={entry ? () => setSelectedPref(isSelected ? null : pref.name) : undefined}
                  className={entry ? 'group/pref cursor-pointer' : undefined}
                >
                  {pref.shapes.map((shape, i) =>
                    shape.tag === 'polygon' ? (
                      <polygon
                        key={i}
                        points={shape.attr}
                        fill={fill}
                        stroke="rgba(255,255,255,0.3)"
                        strokeWidth={1}
                        strokeLinejoin="round"
                      />
                    ) : (
                      <path
                        key={i}
                        d={shape.attr}
                        fill={fill}
                        stroke="rgba(255,255,255,0.3)"
                        strokeWidth={1}
                        strokeLinejoin="round"
                      />
                    )
                  )}
                  {label && (
                    <text
                      x={pref.labelX}
                      y={pref.labelY}
                      textAnchor="middle"
                      fontSize={16}
                      fill="#000000"
                      stroke="rgba(255,255,255,0.9)"
                      strokeWidth={3}
                      paintOrder="stroke"
                      className={
                        isSelected
                          ? 'opacity-100'
                          : 'opacity-0 transition-opacity group-hover/pref:opacity-100'
                      }
                    >
                      {label}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </g>
      </svg>
      <p className="mt-1 text-[10px] text-white/20">
        地図データ:{' '}
        <a
          href="https://github.com/geolonia/japanese-prefectures"
          target="_blank"
          rel="noreferrer"
          className="hover:text-white/40"
        >
          geolonia/japanese-prefectures
        </a>{' '}
        (Wikipedia「日本地図.svg」ベース,{' '}
        <a
          href="https://creativecommons.org/licenses/by-sa/3.0/deed.ja"
          target="_blank"
          rel="noreferrer"
          className="hover:text-white/40"
        >
          CC BY-SA 3.0
        </a>
        )
      </p>

      {selected && (
        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs text-white/40">{selected.prefecture}</p>
          {groupByStation(selected.entries).map((group) => (
            <div key={group.stationName} className="mt-3 first:mt-0">
              <p className="text-sm font-semibold">{group.stationName}の選出楽曲</p>
              <ul className="mt-2 divide-y divide-white/10">
                {group.entries.map((entry, i) => (
                  <li key={i} className="flex items-center gap-3 py-2 text-sm">
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-white/5">
                      {entry.artworkUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={entry.artworkUrl} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      {entry.targetHref ? (
                        <Link href={entry.targetHref} className="block truncate font-medium hover:opacity-70">
                          {entry.targetLabel}
                        </Link>
                      ) : (
                        <span className="block truncate font-medium">{entry.targetLabel}</span>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-white/30">{MUSIC_TYPE_LABEL[entry.musicType]}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
