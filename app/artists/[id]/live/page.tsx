import { Suspense } from 'react'
import { createClient } from '@/utils/Supabase/server'
import { buildArtistAppearanceQuery } from '@/utils/artistAppearanceQuery'
import { formatDate } from '@/utils/format'
import LiveTabs from '@/app/components/artist-detail/LiveTabs'
import SectionHeading from '@/app/components/detail/SectionHeading'
import FestivalPickCard from '@/app/components/detail/FestivalPickCard'
import { headingOf } from '@/app/components/artist-detail/artistSections'

const LIVE_COLOR = headingOf('live').color

type EventInfo = { id: string; name: string; image_url: string | null }
type EditionInfo = { year: number | null; venue: string | null; event: EventInfo | EventInfo[] | null }
type AppearanceRow = {
  id: number
  venue: string | null
  stage: string | null
  start_time: string | null
  event_edition: EditionInfo | EditionInfo[] | null
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function LivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { id } = await params
  const { tab: tabParam } = await searchParams
  const tab = tabParam === 'past' ? 'past' : 'upcoming'

  const supabase = await createClient()
  const { data } = await buildArtistAppearanceQuery<AppearanceRow>(
    supabase,
    id,
    'id, venue, stage, start_time, event_edition:event_edition_id(year, venue, event:event_id(id, name, image_url))'
  )

  const now = new Date().toISOString()
  const rows = (data ?? [])
    .filter((row) => (tab === 'upcoming' ? (row.start_time ?? '') > now : (row.start_time ?? '') <= now))
    .sort((a, b) => (tab === 'upcoming' ? (a.start_time ?? '').localeCompare(b.start_time ?? '') : (b.start_time ?? '').localeCompare(a.start_time ?? '')))

  return (
    <div>
      <SectionHeading {...headingOf('live')} />
      <div className="mt-3">
        <Suspense fallback={null}>
          <LiveTabs tab={tab} />
        </Suspense>
      </div>

      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">{tab === 'upcoming' ? '予定されている出演はありません。' : '過去の出演履歴がありません。'}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {rows.map((row) => {
            const edition = firstOf(row.event_edition)
            const event = edition ? firstOf(edition.event) : null
            const venue = row.venue ?? edition?.venue ?? null
            return (
              <li key={row.id}>
                <FestivalPickCard
                  color={LIVE_COLOR}
                  href={event ? `/events/${event.id}` : null}
                  imageUrl={event?.image_url}
                  eventName={event?.name ?? '—'}
                  dateLabel={row.start_time ? formatDate(row.start_time.slice(0, 10)) : edition?.year ? `${edition.year}年` : undefined}
                  venue={venue}
                  stage={row.stage}
                  upcoming={tab === 'upcoming'}
                />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
