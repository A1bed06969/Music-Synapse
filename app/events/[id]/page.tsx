import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { formatDate } from '@/utils/format'

const EVENT_TYPE_LABEL: Record<string, string> = {
  festival: 'フェス',
  one_off_live: '単発イベント',
  other: 'その他',
}

type Appearance = {
  id: number
  stage: string | null
  venue: string | null
  isHeadliner: boolean
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
      .select('id, stage, venue, is_headliner, artist:artist_id(id, name)')
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
        artistId: artist?.id ?? '',
        artistName: artist?.name ?? '?',
      }
    })
  }

  const distinctVenues = new Set(appearances.map((a) => a.venue ?? ''))
  const groupByVenue = distinctVenues.size > 1

  // 会場が複数ある開催回では会場名が下の見出しに出るため、ここでは
  // event_edition 自体の会場が未設定なら(誤解を招く「会場未定」表示を避けるため)何も出さない
  const venueSummary = selectedEdition
    ? (selectedEdition.venue ?? (!groupByVenue ? (appearances[0]?.venue ?? null) : null))
    : null

  const venueGroups = new Map<string, Appearance[]>()
  for (const a of appearances) {
    const venueKey = groupByVenue ? a.venue ?? 'その他' : '__all__'
    if (!venueGroups.has(venueKey)) venueGroups.set(venueKey, [])
    venueGroups.get(venueKey)!.push(a)
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/events" className="text-xs text-white/40 hover:text-white/70">
        ← イベント一覧
      </Link>

      <p className="mt-4 text-xs text-white/40">
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

          <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] p-4">
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

          {appearances.length === 0 ? (
            <p className="mt-8 text-sm text-white/40">まだ出演アーティストが登録されていません。</p>
          ) : (
            <div className="mt-8 space-y-6">
              {Array.from(venueGroups.entries()).map(([venueKey, rows]) => {
                const stageGroups = new Map<string, Appearance[]>()
                for (const row of rows) {
                  const stageKey = row.stage ?? 'その他'
                  if (!stageGroups.has(stageKey)) stageGroups.set(stageKey, [])
                  stageGroups.get(stageKey)!.push(row)
                }
                return (
                  <div key={venueKey}>
                    {groupByVenue && <h2 className="text-sm font-semibold text-white/80">{venueKey}</h2>}
                    <div className={groupByVenue ? 'mt-3 space-y-4 border-l border-white/10 pl-4' : 'space-y-4'}>
                      {Array.from(stageGroups.entries()).map(([stageKey, stageRows]) => (
                        <div key={stageKey}>
                          <h3 className="text-xs font-medium uppercase tracking-wide text-white/40">{stageKey}</h3>
                          <ul className="mt-2 space-y-1 text-sm">
                            {stageRows.map((a) => (
                              <li key={a.id}>
                                <Link href={`/artists/${a.artistId}`} className="hover:opacity-70">
                                  {a.artistName}
                                </Link>
                                {a.isHeadliner && <span className="text-white/30"> ★ヘッドライナー</span>}
                              </li>
                            ))}
                          </ul>
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
