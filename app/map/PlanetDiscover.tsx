import Link from 'next/link'
import SectionHeading from '@/app/components/detail/SectionHeading'
import { hubContent } from '@/app/components/hub/hubContents'
import { artworkAt } from '@/utils/artworkSize'
import { countryLabel, placeLabel, type PlaceCount } from '@/utils/placeData'

export type RareCountry = { countryCode: string; artistCount: number; artistId: string; artistName: string; imageUrl: string | null }

/** 地図の下: 出身アーティストの多い街、旅する、少ない国(そんな国にも) */
export default function PlanetDiscover({ cities, rareCountries }: { cities: PlaceCount[]; rareCountries: RareCountry[] }) {
  const c = hubContent('planet')
  return (
    <div className="mt-12 grid gap-12">
      <section>
        <SectionHeading number={c.number} label="CITIES" color={c.color} right={`${cities.length}都市から`} />
        <p className="-mt-2 mb-4 text-xs text-white/45">街を選ぶと、その街の出身アーティストを年代ごとに見られます。</p>
        <ul className="flex flex-wrap gap-2">
          {cities.slice(0, 30).map((p) => (
            <li key={p.id}>
              <Link href={`/map/places/${p.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs font-bold transition hover:border-[#a27bff] hover:bg-white/[0.04]">
                {placeLabel(p)}
                <span className="text-white/45">{p.artistCount}</span>
              </Link>
            </li>
          ))}
        </ul>
        <a
          href="/map/travel"
          className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-black text-[#0b0b10] transition hover:brightness-110"
          style={{ background: c.color }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M15.5 8.5l-2 5-5 2 2-5z" />
          </svg>
          どこかへ旅する
        </a>
      </section>

      {rareCountries.length > 0 && (
        <section>
          <SectionHeading number={c.number} label="RARE ORIGINS" color={c.color} right={`${rareCountries.length}か国`} />
          <p className="-mt-2 mb-4 text-xs text-white/45">カタログに、まだ1〜2組しかいない国。そんな国にも、こんなアーティストが。</p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {rareCountries.map((r) => {
              const src = artworkAt(r.imageUrl, 120)
              return (
                <li key={r.countryCode}>
                  <Link href={`/artists/${r.artistId}`} className="flex items-center gap-3 rounded-xl border border-white/10 p-2.5 transition hover:border-white/25 hover:bg-white/[0.04]">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt="" loading="lazy" decoding="async" className="h-12 w-12 shrink-0 rounded-full bg-white/5 object-cover" />
                    ) : (
                      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/10 font-black text-white/40">{r.artistName.slice(0, 1)}</span>
                    )}
                    <span className="min-w-0">
                      <span className="block text-[11px] text-white/50">
                        {countryLabel(r.countryCode)} ・ {r.artistCount}組
                      </span>
                      <span className="block truncate text-sm font-bold">{r.artistName}</span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
