'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { formatDate } from '@/utils/format'
import MapClientWrapper from '@/app/map/MapClientWrapper'
import type { MapMarker } from '@/app/map/LeafletMap'

const WEEKDAY_LABEL_JA = ['日', '月', '火', '水', '木', '金', '土']

function formatDayHeading(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${WEEKDAY_LABEL_JA[d.getUTCDay()]})`
}

export type EditionDateEntry = { id: string; date: string; venue: string; region: string | null }

export type Appearance = {
  id: number
  stage: string | null
  venue: string | null
  isHeadliner: boolean
  performanceDate: string | null
  timeLabel: string | null
  artistId: string
  artistName: string
  artistImageUrl: string | null
}

const NO_DATE = '__no_date__'
const ALL_REGIONS = '__all__'

export default function EventScheduleView({
  editionDates,
  editionDescription,
  venueSummary,
  editionStartDate,
  editionEndDate,
  venueMarkers,
  appearances,
}: {
  editionDates: EditionDateEntry[]
  editionDescription: string | null
  venueSummary: string | null
  editionStartDate: string | null
  editionEndDate: string | null
  venueMarkers: MapMarker[]
  appearances: Appearance[]
}) {
  // SUMMER SONICのように同じ日程で東京・大阪など複数都市が同時開催される場合、
  // event_edition_dateに登録された都市名(region)が2種類以上あればタブを出す。
  const regions = useMemo(
    () => Array.from(new Set(editionDates.map((ed) => ed.region).filter((r): r is string => !!r))),
    [editionDates]
  )
  const [selectedRegion, setSelectedRegion] = useState<string>(ALL_REGIONS)

  // 会場名 → 都市名の対応表。出演情報(event_appearance)側は都市を持たないため、
  // 会場名を手がかりにどちらの都市の公演かを判定する。
  const venueToRegion = useMemo(() => {
    const map = new Map<string, string>()
    for (const ed of editionDates) {
      if (ed.region) map.set(ed.venue, ed.region)
    }
    return map
  }, [editionDates])

  const filteredEditionDates =
    regions.length < 2 || selectedRegion === ALL_REGIONS
      ? editionDates
      : editionDates.filter((ed) => ed.region === selectedRegion)

  // 「すべて」タブでは、東京・大阪など複数都市の日程が同じ日に重複して並ぶため、
  // 会場ごとの個別カードではなく「3 Days ・ 8月14日〜8月16日」という日数サマリー
  // のみを表示する(会場は都市によって異なり、この時点では一意に決まらないため)。
  const showAllRegionsSummary = regions.length >= 2 && selectedRegion === ALL_REGIONS
  const distinctAllDates = useMemo(
    () => Array.from(new Set(editionDates.map((ed) => ed.date))).sort(),
    [editionDates]
  )

  const filteredVenueMarkers =
    regions.length < 2 || selectedRegion === ALL_REGIONS
      ? venueMarkers
      : venueMarkers.filter((m) => {
          const r = venueToRegion.get(m.label)
          return r === undefined || r === selectedRegion
        })

  // 会場が都市マップに載っていない(=どちらの都市か判定できない)出演情報は、
  // 誤って非表示にしないよう、どのタブでも表示したままにする。
  const filteredAppearances =
    regions.length < 2 || selectedRegion === ALL_REGIONS
      ? appearances
      : appearances.filter((a) => {
          const r = venueToRegion.get(a.venue ?? '')
          return r === undefined || r === selectedRegion
        })

  const dayGroups = new Map<string, Appearance[]>()
  for (const a of filteredAppearances) {
    const key = a.performanceDate ?? NO_DATE
    if (!dayGroups.has(key)) dayGroups.set(key, [])
    dayGroups.get(key)!.push(a)
  }
  const sortedDayKeys = Array.from(dayGroups.keys()).sort((a, b) => {
    if (a === NO_DATE) return 1
    if (b === NO_DATE) return -1
    return a.localeCompare(b)
  })

  return (
    <>
      {regions.length >= 2 && (
        <div className="mt-6 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedRegion(ALL_REGIONS)}
            className={`rounded-full border px-3 py-1 text-xs ${
              selectedRegion === ALL_REGIONS
                ? 'border-white bg-white text-black'
                : 'border-white/15 text-white/60 hover:border-white/30'
            }`}
          >
            すべて
          </button>
          {regions.map((region) => (
            <button
              key={region}
              type="button"
              onClick={() => setSelectedRegion(region)}
              className={`rounded-full border px-3 py-1 text-xs ${
                selectedRegion === region
                  ? 'border-white bg-white text-black'
                  : 'border-white/15 text-white/60 hover:border-white/30'
              }`}
            >
              {region}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-stretch">
        {showAllRegionsSummary ? (
          <div className="flex-1 rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <p className="text-sm font-medium text-white/85">
              {distinctAllDates.length} Days
              {distinctAllDates.length > 0 &&
                ` ・ ${formatDate(distinctAllDates[0])}${
                  distinctAllDates.length > 1 ? `〜${formatDate(distinctAllDates[distinctAllDates.length - 1])}` : ''
                }`}
            </p>
            {editionDescription && <p className="mt-2 text-xs text-white/50">{editionDescription}</p>}
          </div>
        ) : filteredEditionDates.length > 0 ? (
          <div className="flex-1 space-y-2">
            {filteredEditionDates.map((ed, i) => (
              <div key={ed.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                <p className="text-sm font-medium text-white/85">
                  Day {i + 1} ・ {formatDayHeading(ed.date)}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-white/40">📍 {ed.venue}</p>
              </div>
            ))}
            {editionDescription && <p className="text-xs text-white/50">{editionDescription}</p>}
          </div>
        ) : (
          <div className="flex-1 rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <p className="text-sm text-white/70">
              {venueSummary}
              {editionStartDate &&
                `${venueSummary ? ' ・ ' : ''}${formatDate(editionStartDate)}${
                  editionEndDate && editionEndDate !== editionStartDate ? `〜${formatDate(editionEndDate)}` : ''
                }`}
            </p>
            {editionDescription && <p className="mt-2 text-xs text-white/50">{editionDescription}</p>}
          </div>
        )}
        {filteredVenueMarkers.length > 0 && (
          <div className="lg:w-80 lg:shrink-0">
            <MapClientWrapper markers={filteredVenueMarkers} heightClassName="h-[180px]" />
          </div>
        )}
      </div>

      {filteredAppearances.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">まだ出演アーティストが登録されていません。</p>
      ) : (
        <div className="mt-8 space-y-8">
          <h2 className="text-lg font-semibold">日程・出演アーティスト</h2>
          {sortedDayKeys.map((dayKey, dayIndex) => {
            const rows = dayGroups.get(dayKey)!
            const dayVenue = rows.find((a) => a.venue)?.venue ?? venueSummary

            const stageGroups = new Map<string, Appearance[]>()
            for (const row of rows) {
              const stageKey = row.stage ?? 'その他'
              if (!stageGroups.has(stageKey)) stageGroups.set(stageKey, [])
              stageGroups.get(stageKey)!.push(row)
            }

            return (
              <div key={dayKey} className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                <h3 className="font-semibold">
                  {dayKey === NO_DATE ? '日程未定' : `Day ${dayIndex + 1} ・ ${formatDayHeading(dayKey)}`}
                </h3>
                {dayVenue && <p className="mt-0.5 flex items-center gap-1 text-xs text-white/40">📍 {dayVenue}</p>}

                <div className="mt-4 space-y-3">
                  {Array.from(stageGroups.entries()).map(([stageKey, stageRows]) => (
                    <div key={stageKey}>
                      {stageGroups.size > 1 && (
                        <h4 className="text-xs font-medium uppercase tracking-wide text-white/40">{stageKey}</h4>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {stageRows.map((a) => (
                          <Link
                            key={a.id}
                            href={`/artists/${a.artistId}`}
                            className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition hover:border-white/40 hover:bg-white/[0.08] ${
                              a.isHeadliner
                                ? 'border-white/40 bg-white/[0.06] font-semibold'
                                : 'border-white/15 bg-white/[0.03] text-white/85'
                            }`}
                          >
                            {a.artistImageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={a.artistImageUrl}
                                alt=""
                                className="h-10 w-10 shrink-0 rounded-full object-cover"
                              />
                            ) : (
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-base">
                                🎤
                              </span>
                            )}
                            <span className="leading-tight">
                              <span className="block">{a.artistName}</span>
                              {a.isHeadliner && (
                                <span className="block text-[10px] font-semibold tracking-wide text-amber-400">
                                  ★ ヘッドライナー
                                </span>
                              )}
                              {a.timeLabel && <span className="block text-xs text-white/40">{a.timeLabel}</span>}
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
