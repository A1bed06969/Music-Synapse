import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { geocodeVenue } from '@/utils/nominatim'
import { importVenueLocation } from './actions'
import SubmitButton from './SubmitButton'

export default async function VenuesPage({
  searchParams,
}: {
  searchParams: Promise<{ venue?: string; success?: string; error?: string }>
}) {
  const { venue, success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  const [{ data: musicEvents }, { data: eventEditions }, { data: eventAppearances }, { data: existingLocations }] =
    await Promise.all([
      supabase.from('music_event').select('venue'),
      supabase.from('event_edition').select('venue'),
      supabase.from('event_appearance').select('venue'),
      supabase.from('venue_location').select('venue_name'),
    ])

  const knownNames = new Set((existingLocations ?? []).map((v) => v.venue_name))
  const allVenueNames = new Set<string>()
  for (const rows of [musicEvents, eventEditions, eventAppearances]) {
    for (const row of rows ?? []) {
      if (row.venue) allVenueNames.add(row.venue)
    }
  }
  const unresolvedVenues = Array.from(allVenueNames)
    .filter((name) => !knownNames.has(name))
    .sort()
  const unresolvedVenueSet = new Set(unresolvedVenues)
  const isKnownUnresolvedVenue = venue !== undefined && unresolvedVenueSet.has(venue)

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">会場の座標登録</h1>

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      {venue ? (
        isKnownUnresolvedVenue ? (
          <VenueCandidates venueName={venue} />
        ) : (
          <p className="mt-8 text-sm text-white/40">不明な会場です。</p>
        )
      ) : unresolvedVenues.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">未登録の会場はありません。</p>
      ) : (
        <ul className="mt-8 space-y-1.5 text-sm">
          {unresolvedVenues.map((name) => (
            <li key={name} className="flex items-center justify-between gap-2">
              <span>{name}</span>
              <Link
                href={`/admin/data/venues?venue=${encodeURIComponent(name)}`}
                prefetch={false}
                className="text-xs text-white/40 hover:text-white/70"
              >
                座標を検索 →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

async function VenueCandidates({ venueName }: { venueName: string }) {
  let results
  try {
    results = await geocodeVenue(venueName)
  } catch (err) {
    console.error('Nominatim検索に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">検索に失敗しました。</p>
  }

  if (results.length === 0) {
    return <p className="mt-8 text-sm text-white/40">該当する候補が見つかりませんでした。</p>
  }

  return (
    <div className="mt-8">
      <Link href="/admin/data/venues" prefetch={false} className="text-xs text-white/40 hover:text-white/70">
        ← 会場一覧に戻る
      </Link>

      <div className="mt-4 space-y-2">
        {results.map((r, i) => (
          <form
            key={i}
            action={importVenueLocation}
            className="flex items-center justify-between gap-3 rounded-md border border-white/15 px-4 py-3 text-sm"
          >
            <input type="hidden" name="venue_name" value={venueName} />
            <input type="hidden" name="latitude" value={r.latitude} />
            <input type="hidden" name="longitude" value={r.longitude} />
            <span>{r.displayName}</span>
            <SubmitButton />
          </form>
        ))}
      </div>
    </div>
  )
}
