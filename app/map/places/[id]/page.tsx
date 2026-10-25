import Link from 'next/link'
import { notFound } from 'next/navigation'
import HubShell, { HubIdentity } from '@/app/components/hub/HubShell'
import SectionHeading from '@/app/components/detail/SectionHeading'
import { hubContent } from '@/app/components/hub/hubContents'
import { artworkAt } from '@/utils/artworkSize'
import { countryLabel, fetchPlace, fetchPlaceArtists, fetchPlaceCounts, fetchPlaceTopGenres, groupByDecade, placeLabel } from '@/utils/placeData'
import { createClient } from '@/utils/Supabase/server'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const place = await fetchPlace(supabase, id)
  return { title: place ? `${placeLabel(place)}出身のアーティスト | Music Planet Tour | Music Synapse` : 'Music Planet Tour | Music Synapse' }
}

function Face({ id, name, imageUrl, size }: { id: string; name: string; imageUrl: string | null; size: number }) {
  const src = artworkAt(imageUrl, size * 2)
  return (
    <Link href={`/artists/${id}`} className="group flex min-w-0 flex-col items-center gap-1.5 text-center" style={{ width: size + 8 }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" className="rounded-full bg-white/5 object-cover ring-1 ring-white/10 transition group-hover:ring-[#a27bff]" style={{ width: size, height: size }} />
      ) : (
        <span className="grid place-items-center rounded-full bg-white/10 text-lg font-black text-white/40" style={{ width: size, height: size }}>
          {name.slice(0, 1)}
        </span>
      )}
      <span className="line-clamp-2 text-[11px] font-bold leading-tight">{name}</span>
    </Link>
  )
}

/** 都市のページ: この街の出身アーティストを、最初のリリース年の年代ごとに並べる */
export default async function PlacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const place = await fetchPlace(supabase, id)
  if (!place) notFound()
  const c = hubContent('planet')
  const [artists, genres, countryPlaces] = await Promise.all([
    fetchPlaceArtists(supabase, id),
    fetchPlaceTopGenres(supabase, id),
    fetchPlaceCounts(supabase, place.countryCode),
  ])
  const decades = groupByDecade(artists)
  const label = placeLabel(place)
  const country = countryLabel(place.countryCode)
  const countryTotal = countryPlaces.reduce((s, p) => s + p.artistCount, 0)
  const otherCities = countryPlaces.filter((p) => p.id !== id).slice(0, 8)

  const left = (
    <div className="grid gap-4">
      <div className="rounded-2xl border border-white/10 p-4" style={{ background: `linear-gradient(160deg, ${c.color}1f, transparent 60%), #121218` }}>
        <p className="text-[11px] font-bold tracking-[0.16em]" style={{ color: c.color }}>
          CITY ・ {country}
          {place.adminName ? ` / ${place.adminName}` : ''}
        </p>
        <h1 className="mt-1 text-3xl font-black leading-tight [text-wrap:balance]">{label}</h1>
        {label !== place.name && <p className="mt-0.5 text-sm text-white/50">{place.name}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <dt className="text-[10px] text-white/45">出身アーティスト</dt>
            <dd className="text-2xl font-black" style={{ color: c.color }}>
              {artists.length}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-white/45">{country}全体</dt>
            <dd className="text-2xl font-black">{countryTotal}</dd>
          </div>
        </dl>
      </div>
      <Link href="/map" className="text-sm font-bold" style={{ color: c.color }}>
        ← 地図に戻る
      </Link>
    </div>
  )

  const body = (
    <>
      <SectionHeading number={c.number} label="THE SCENE BY ERA" color={c.color} right={`${artists.length}組`} />
      <p className="-mt-2 mb-6 text-xs text-white/45">最初のリリースの年で並べると、この街のシーンの世代が見えます。</p>
      {artists.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/15 p-5 text-sm text-white/55">この街の出身のアーティストは、まだいません。</p>
      ) : (
        <div className="grid gap-8">
          {decades.map((d) => (
            <section key={d.label} className="grid gap-3 sm:grid-cols-[88px_minmax(0,1fr)]">
              <h2 className="text-2xl font-black leading-none text-white/85">{d.label}</h2>
              <ul className="flex flex-wrap gap-x-3 gap-y-4">
                {d.artists.map((a) => (
                  <li key={a.id}>
                    <Face id={a.id} name={a.name} imageUrl={a.imageUrl} size={76} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  )

  const right = (
    <div className="grid gap-10">
      {genres.length > 0 && (
        <section>
          <SectionHeading number={c.number} label="GENRES" color={c.color} />
          <p className="mb-3 text-xs text-white/45">この街の出身アーティストに多いジャンル</p>
          <ul className="flex flex-wrap gap-2">
            {genres.map((g, i) => (
              <li key={g.id}>
                <Link
                  href={`/genres/${g.id}`}
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold"
                  style={i === 0 ? { borderColor: c.color, background: `${c.color}26` } : { borderColor: 'rgba(255,255,255,0.15)' }}
                >
                  {g.name}
                  <span className="text-white/45">{g.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {otherCities.length > 0 && (
        <section>
          <SectionHeading number={c.number} label="SAME COUNTRY" color={c.color} />
          <p className="mb-3 text-xs text-white/45">{country}の、ほかの街</p>
          <ul className="grid gap-1.5">
            {otherCities.map((p) => (
              <li key={p.id}>
                <Link href={`/map/places/${p.id}`} className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-sm font-bold hover:bg-white/[0.04]">
                  <span className="truncate">{placeLabel(p)}</span>
                  <span className="shrink-0 text-xs text-white/45">{p.artistCount}組</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <SectionHeading number={c.number} label="MUSIC SPOTS" color={c.color} />
        <p className="rounded-xl border border-dashed border-white/15 p-4 text-xs leading-relaxed text-white/50">
          この街のライブハウス・フェス会場・レコードショップは、準備中です。
        </p>
      </section>
    </div>
  )

  return (
    <HubShell
      hubKey="planet"
      leftExtra={left}
      rightExtra={right}
      mobileContent={
        <>
          <HubIdentity hubKey="planet" />
          <div className="mt-2">{left}</div>
          <div className="mt-10">{body}</div>
          <div className="mt-12">{right}</div>
        </>
      }
    >
      {body}
    </HubShell>
  )
}
