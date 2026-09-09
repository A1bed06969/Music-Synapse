import { Suspense } from 'react'
import { createClient } from '@/utils/Supabase/server'
import { buildArtistAppearanceQuery } from '@/utils/artistAppearanceQuery'
import { formatDate } from '@/utils/format'
import LiveTabs from '@/app/components/artist-detail/LiveTabs'

type AppearanceRow = {
  id: number
  venue: string | null
  start_time: string | null
  event_edition: { year: number | null; venue: string | null; event: { name: string } | { name: string }[] | null } | { year: number | null; venue: string | null; event: { name: string } | { name: string }[] | null }[] | null
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
    'id, venue, start_time, event_edition:event_edition_id(year, venue, event:event_id(name))'
  )

  const now = new Date().toISOString()
  const rows = (data ?? [])
    .filter((row) => (tab === 'upcoming' ? (row.start_time ?? '') > now : (row.start_time ?? '') <= now))
    .sort((a, b) => (tab === 'upcoming' ? (a.start_time ?? '').localeCompare(b.start_time ?? '') : (b.start_time ?? '').localeCompare(a.start_time ?? '')))

  return (
    <div>
      <h2 className="text-xs uppercase tracking-wide text-white/40">Festival & Live</h2>
      <div className="mt-3">
        <Suspense fallback={null}>
          <LiveTabs tab={tab} />
        </Suspense>
      </div>

      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">{tab === 'upcoming' ? '予定されている出演はありません。' : '過去の出演履歴がありません。'}</p>
      ) : (
        <ul className="mt-4 divide-y divide-white/5">
          {rows.map((row) => {
            const edition = firstOf(row.event_edition)
            const event = edition ? firstOf(edition.event) : null
            return (
              <li key={row.id} className="py-3 text-sm">
                <p className="font-medium">{event?.name ?? '—'}</p>
                <p className="mt-0.5 text-xs text-white/40">
                  {row.start_time ? formatDate(row.start_time.slice(0, 10)) : edition?.year ? `${edition.year}年` : ''}
                  {(row.venue ?? edition?.venue) ? ` · ${row.venue ?? edition?.venue}` : ''}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
