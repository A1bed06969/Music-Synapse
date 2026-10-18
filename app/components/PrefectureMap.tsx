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

/** 全国放送のTV局。都道府県に載せられないので、地図の太平洋側の余白に局ごとのバッジとして置く */
export type TvStationData = {
  stationName: string
  /** 地図のバッジに出す短い名前 */
  shortName: string
  entries: (PrefectureEntry & { campaign: string | null })[]
}

// 太平洋の余白(viewBox 1000x1000 の右下)に縦に並べるピルの配置。スマホでは地図全体が約0.4倍に縮むので、
// 文字は viewBox 上でかなり大きめにしている
const TV_PILL = { x: 655, width: 320, height: 84, gap: 20, top: 690 }
const TV_ACCENT = '#ff7a2f'

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

export default function PrefectureMap({ data, tv = [] }: { data: PrefectureMapData[]; tv?: TvStationData[] }) {
  const [selectedPref, setSelectedPref] = useState<string | null>(null)

  const dataByPrefecture = new Map(data.map((d) => [d.prefecture, d]))
  const selected = selectedPref ? dataByPrefecture.get(selectedPref) : null
  const selectedTv = selectedPref?.startsWith('tv:') ? tv.find((t) => `tv:${t.stationName}` === selectedPref) : null

  if (data.length === 0 && tv.length === 0) {
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
                ? TV_ACCENT
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
        <g>
          <text
            x={TV_PILL.x + TV_PILL.width / 2}
            y={TV_PILL.top - 26}
            textAnchor="middle"
            fontSize={26}
            fontWeight={700}
            letterSpacing={4}
            fill={TV_ACCENT}
          >
            TV ・ 全国放送
          </text>
          {tv.slice(0, 3).map((station, i) => {
            const y = TV_PILL.top + i * (TV_PILL.height + TV_PILL.gap)
            const key = `tv:${station.stationName}`
            const isSelected = selectedPref === key
            const hasData = station.entries.length > 0
            const textColor = isSelected ? '#000000' : hasData ? '#ffffff' : 'rgba(255,255,255,0.3)'
            return (
              <g
                key={key}
                transform={`translate(${TV_PILL.x} ${y})`}
                onClick={hasData ? () => setSelectedPref(isSelected ? null : key) : undefined}
                className={hasData ? 'cursor-pointer' : undefined}
              >
                <rect
                  width={TV_PILL.width}
                  height={TV_PILL.height}
                  rx={TV_PILL.height / 2}
                  fill={isSelected ? TV_ACCENT : hasData ? 'rgba(255,122,47,0.14)' : 'rgba(255,255,255,0.04)'}
                  stroke={hasData ? TV_ACCENT : 'rgba(255,255,255,0.15)'}
                  strokeWidth={3}
                />
                <text x={36} y={TV_PILL.height / 2 + 13} fontSize={38} fontWeight={700} fill={textColor}>
                  {station.shortName}
                </text>
                <text
                  x={TV_PILL.width - 36}
                  y={TV_PILL.height / 2 + 14}
                  textAnchor="end"
                  fontSize={40}
                  fontWeight={800}
                  fill={isSelected ? '#000000' : hasData ? TV_ACCENT : 'rgba(255,255,255,0.3)'}
                >
                  {station.entries.length}
                  <tspan fontSize={26} fontWeight={600} dx={4}>
                    曲
                  </tspan>
                </text>
              </g>
            )
          })}
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

      {selectedTv && (
        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs text-white/40">TV(全国放送)</p>
          <p className="text-sm font-semibold">{selectedTv.stationName}の選出楽曲</p>
          <ul className="mt-2 divide-y divide-white/10">
            {selectedTv.entries.map((entry, i) => (
              <li key={i} className="flex items-center gap-3 py-2 text-sm">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-white/5">
                  {entry.artworkUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.artworkUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
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
                  {entry.campaign && <span className="block truncate text-xs text-white/40">{entry.campaign}</span>}
                </div>
                <span className="shrink-0 text-xs text-white/30">{MUSIC_TYPE_LABEL[entry.musicType]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
