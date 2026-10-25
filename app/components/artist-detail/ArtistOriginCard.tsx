import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hubContent } from '@/app/components/hub/hubContents'
import { artworkAt } from '@/utils/artworkSize'
import { countryLabel, fetchPlace, fetchPlaceArtists, fetchPlaceCounts, placeLabel } from '@/utils/placeData'

/** アーティストページの「出身地」: この街の出身 → 同じ街の出身アーティスト → 同じ国のほかの街(Music Planet Tour への入口) */
export default async function ArtistOriginCard({ supabase, artistId, placeId }: { supabase: SupabaseClient; artistId: string; placeId: string | null }) {
  if (!placeId) return null
  const place = await fetchPlace(supabase, placeId)
  if (!place) return null
  const [artists, countryPlaces] = await Promise.all([fetchPlaceArtists(supabase, placeId), fetchPlaceCounts(supabase, place.countryCode)])
  const c = hubContent('planet')
  const others = artists.filter((a) => a.id !== artistId)
  // 写真のあるアーティストを先に、リリースの多い順
  const neighbors = [...others].sort((a, b) => Number(Boolean(b.imageUrl)) - Number(Boolean(a.imageUrl)) || b.albumCount - a.albumCount).slice(0, 10)
  const otherCities = countryPlaces.filter((p) => p.id !== placeId).slice(0, 3)
  const label = placeLabel(place)
  const country = countryLabel(place.countryCode)

  return (
    <section className="mt-9">
      <p className="text-[11px] font-bold tracking-[0.16em]" style={{ color: c.color }}>
        ORIGIN
      </p>
      <Link
        href={`/map/places/${place.id}`}
        className="mt-2.5 flex items-center gap-4 rounded-xl border px-4 py-3 transition hover:brightness-125"
        style={{ borderColor: `${c.color}73`, background: `linear-gradient(150deg, ${c.color}2e, transparent 70%)` }}
      >
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full" style={{ background: `${c.color}33` }}>
          <span className="h-3.5 w-3.5 rounded-full ring-2 ring-white" style={{ background: c.color }} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] text-white/50">出身地</span>
          <span className="block truncate text-xl font-black">
            {label}
            <span className="ml-1.5 text-sm font-medium text-white/55">・ {country}</span>
          </span>
          {others.length > 0 && (
            <span className="block text-xs font-bold" style={{ color: c.color }}>
              この街の出身は、ほかに{others.length}組 →
            </span>
          )}
        </span>
      </Link>

      {neighbors.length > 0 && (
        <>
          <p className="mt-5 text-xs font-bold text-white/70">同じ街の出身</p>
          <ul className="mt-2 flex gap-3 overflow-x-auto pb-1">
            {neighbors.map((a) => {
              const src = artworkAt(a.imageUrl, 160)
              return (
                <li key={a.id} className="w-[76px] shrink-0">
                  <Link href={`/artists/${a.id}`} className="group flex flex-col items-center gap-1.5 text-center">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt="" loading="lazy" decoding="async" className="h-[68px] w-[68px] rounded-full bg-white/5 object-cover ring-1 ring-white/10 transition group-hover:ring-[#a27bff]" />
                    ) : (
                      <span className="grid h-[68px] w-[68px] place-items-center rounded-full bg-white/10 text-lg font-black text-white/40">{a.name.slice(0, 1)}</span>
                    )}
                    <span className="line-clamp-2 text-[11px] font-bold leading-tight">{a.name}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {otherCities.length > 0 && (
        <>
          <p className="mt-5 text-xs font-bold text-white/70">{country}の、ほかの街から</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {otherCities.map((p) => (
              <li key={p.id}>
                <Link href={`/map/places/${p.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs font-bold hover:bg-white/[0.05]">
                  {placeLabel(p)}
                  <span className="text-white/45">{p.artistCount}組</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
