import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { formatDate } from '@/utils/format'
import MapClientWrapper from '@/app/map/MapClientWrapper'
import type { MapMarker } from '@/app/map/LeafletMap'

const EVENT_TYPE_LABEL: Record<string, string> = {
  festival: 'フェス',
  one_off_live: '単発イベント',
  other: 'その他',
}

const WEEKDAY_LABEL_JA = ['日', '月', '火', '水', '木', '金', '土']

function formatDayHeading(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${WEEKDAY_LABEL_JA[d.getUTCDay()]})`
}

type Appearance = {
  id: number
  stage: string | null
  venue: string | null
  isHeadliner: boolean
  performanceDate: string | null
  artistId: string
  artistName: string
}

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ year?: string }>
}) {
  const { id } = await params
  const { year: yearParam } = await searchParams
  const supabase = await createClient()

  const { data: event, error } = await supabase
    .from('event')
    .select('id, name, event_type, founded_year, country, prefecture, description')
    .eq('id', id)
    .single()

  if (error || !event) {
    notFound()
  }

  const { data: editions } = await supabase
    .from('event_edition')
    .select('id, year, start_date, end_date, venue, description')
    .eq('event_id', id)
    .order('year', { ascending: false })

  const editionList = editions ?? []
  const requestedYear = yearParam ? Number(yearParam) : null
  const selectedEdition =
    (requestedYear ? editionList.find((ed) => ed.year === requestedYear) : null) ?? editionList[0] ?? null

  let appearances: Appearance[] = []

  if (selectedEdition) {
    const { data: appearanceRows } = await supabase
      .from('event_appearance')
      .select('id, stage, venue, is_headliner, start_time, artist:artist_id(id, name)')
      .eq('event_edition_id', selectedEdition.id)
      .order('is_headliner', { ascending: false })
      .order('start_time', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })

    appearances = (appearanceRows ?? []).map((row) => {
      const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
      return {
        id: row.id,
        stage: row.stage,
        venue: row.venue ?? selectedEdition.venue ?? null,
        isHeadliner: row.is_headliner,
        performanceDate: row.start_time ? row.start_time.slice(0, 10) : null,
        artistId: artist?.id ?? '',
        artistName: artist?.name ?? '?',
      }
    })
  }

  const venueSummary = selectedEdition
    ? (selectedEdition.venue ?? appearances.find((a) => a.venue)?.venue ?? null)
    : null

  let venueMarker: MapMarker | null = null
  if (venueSummary) {
    const { data: venueLocation } = await supabase
      .from('venue_location')
      .select('latitude, longitude')
      .eq('venue_name', venueSummary)
      .maybeSingle()
    if (venueLocation) {
      venueMarker = {
        id: 'venue',
        latitude: venueLocation.latitude,
        longitude: venueLocation.longitude,
        color: '#e8a63c',
        popupHtml: venueSummary,
      }
    }
  }

  const NO_DATE = '__no_date__'
  const dayGroups = new Map<string, Appearance[]>()
  for (const a of appearances) {
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
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/events" className="text-xs text-white/40 hover:text-white/70">
        ← イベント一覧
      </Link>

      <div className="mt-6 flex flex-col gap-6 sm:flex-row">
        <div className="flex aspect-square w-full shrink-0 items-center justify-center rounded-lg border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.01] sm:w-64">
          <span className="text-6xl">🎪</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-white/40">
            {event.event_type ? EVENT_TYPE_LABEL[event.event_type] ?? event.event_type : ''}
            {event.founded_year ? ` · ${event.founded_year}年〜` : ''}
          </p>
          <h1 className="mt-1 text-2xl font-bold">{event.name}</h1>
          {(event.country || event.prefecture) && (
            <p className="mt-1 text-sm text-white/50">
              {[event.country, event.prefecture].filter(Boolean).join(' / ')}
            </p>
          )}
          {event.description && <p className="mt-3 text-sm leading-relaxed text-white/70">{event.description}</p>}
        </div>
      </div>

      {editionList.length === 0 || !selectedEdition ? (
        <p className="mt-10 text-sm text-white/40">まだ開催情報が登録されていません。</p>
      ) : (
        <>
          <div className="mt-8 flex flex-wrap gap-2">
            {editionList.map((ed) => (
              <Link
                key={ed.id}
                href={`/events/${id}?year=${ed.year}`}
                className={`rounded-full border px-3 py-1 text-xs ${
                  ed.year === selectedEdition.year
                    ? 'border-white bg-white text-black'
                    : 'border-white/15 text-white/60 hover:border-white/30'
                }`}
              >
                {ed.year}
              </Link>
            ))}
          </div>

          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-stretch">
            <div className="flex-1 rounded-lg border border-white/10 bg-white/[0.02] p-4">
              <p className="text-sm text-white/70">
                {venueSummary}
                {selectedEdition.start_date &&
                  `${venueSummary ? ' ・ ' : ''}${formatDate(selectedEdition.start_date)}${
                    selectedEdition.end_date && selectedEdition.end_date !== selectedEdition.start_date
                      ? `〜${formatDate(selectedEdition.end_date)}`
                      : ''
                  }`}
              </p>
              {selectedEdition.description && (
                <p className="mt-2 text-xs text-white/50">{selectedEdition.description}</p>
              )}
            </div>
            {venueMarker && (
              <div className="lg:w-80 lg:shrink-0">
                <MapClientWrapper markers={[venueMarker]} heightClassName="h-[180px]" />
              </div>
            )}
          </div>

          {appearances.length === 0 ? (
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
                    {dayVenue && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-white/40">📍 {dayVenue}</p>
                    )}

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
                                className={`rounded-full border px-3 py-1.5 text-sm transition hover:border-white/40 hover:bg-white/[0.08] ${
                                  a.isHeadliner
                                    ? 'border-white/40 bg-white/[0.06] font-semibold'
                                    : 'border-white/15 bg-white/[0.03] text-white/85'
                                }`}
                              >
                                {a.artistName}
                                {a.isHeadliner && ' ★'}
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
      )}
    </div>
  )
}
