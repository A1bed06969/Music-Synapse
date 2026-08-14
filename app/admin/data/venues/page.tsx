import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { geocodeVenue, geocodeWithFallback } from '@/utils/nominatim'
import { importVenueLocation } from './actions'
import SubmitButton from './SubmitButton'

const inputClass =
  'w-full max-w-md rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none'
const buttonClass = 'rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85'

export default async function VenuesPage({
  searchParams,
}: {
  searchParams: Promise<{ venue?: string; address?: string; success?: string; error?: string }>
}) {
  const { venue, address, success, error: errorMessage } = await searchParams
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
    <div className="mx-auto max-w-[1600px] px-6 py-12">
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
          <VenueCandidates venueName={venue} address={address} />
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

async function VenueCandidates({ venueName, address }: { venueName: string; address?: string }) {
  // 会場名での検索が施設名の表記揺れ等でヒットしない/誤ヒットする場合に備えて、
  // 住所を入力してGSI/Nominatimで検索し直せる代替手段を用意する
  if (address) {
    return <VenueAddressCandidates venueName={venueName} address={address} />
  }

  let results
  try {
    results = await geocodeVenue(venueName)
  } catch (err) {
    console.error('Nominatim検索に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">検索に失敗しました。</p>
  }

  return (
    <div className="mt-8">
      <Link href="/admin/data/venues" prefetch={false} className="text-xs text-white/40 hover:text-white/70">
        ← 会場一覧に戻る
      </Link>

      {results.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">会場名では該当する候補が見つかりませんでした。</p>
      ) : (
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
              <input type="hidden" name="geocode_source" value="nominatim" />
              <span>{r.displayName}</span>
              <SubmitButton />
            </form>
          ))}
        </div>
      )}

      <div className="mt-6 border-t border-white/10 pt-4">
        <p className="text-xs text-white/40">会場名で見つからない、または違う場所がヒットする場合は、住所で検索してください。</p>
        <form action="/admin/data/venues" className="mt-2 flex flex-wrap gap-2">
          <input type="hidden" name="venue" value={venueName} />
          <input name="address" placeholder="例: 東京都渋谷区宇田川町20-1、大阪府大阪市" className={inputClass} />
          <button type="submit" className={buttonClass}>
            住所で検索
          </button>
        </form>
      </div>
    </div>
  )
}

async function VenueAddressCandidates({ venueName, address }: { venueName: string; address: string }) {
  let results
  let isApproximate = false
  let geocodeSource: 'gsi' | 'nominatim' = 'nominatim'
  try {
    const geocoded = await geocodeWithFallback(address)
    results = geocoded.results
    isApproximate = geocoded.isApproximate
    geocodeSource = geocoded.source
  } catch (err) {
    console.error('住所検索に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">検索に失敗しました。</p>
  }

  return (
    <div className="mt-8">
      <Link
        href={`/admin/data/venues?venue=${encodeURIComponent(venueName)}`}
        prefetch={false}
        className="text-xs text-white/40 hover:text-white/70"
      >
        ← 会場名の候補に戻る
      </Link>

      {results.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">
          該当する候補が見つかりませんでした。「東京都渋谷区」のように都道府県・市区町村名だけで再検索すると見つかることがあります。
        </p>
      ) : (
        <>
          {isApproximate && (
            <p className="mt-4 text-xs text-white/40">
              入力された詳細住所は見つからなかったため、周辺エリアの代表地点を表示しています。
            </p>
          )}
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
                <input type="hidden" name="geocode_source" value={geocodeSource} />
                <span>{r.displayName}</span>
                <SubmitButton />
              </form>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
