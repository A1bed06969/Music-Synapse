import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { continentForCountry, CONTINENT_ORDER } from '@/utils/continents'

const EVENT_TYPE_LABEL: Record<string, string> = {
  festival: 'フェス',
  one_off_live: '単発イベント',
  tour: 'ツアー',
  other: 'その他',
}

const NO_GENRE = 'ジャンル未設定'

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ event_type?: string }>
}) {
  const { event_type: eventType } = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from('event')
    .select('id, name, event_type, founded_year, country, image_url, genre:genre_id(name)')
    .order('name')

  if (eventType) query = query.eq('event_type', eventType)

  const { data: events } = await query

  type EventRow = {
    id: string
    name: string
    event_type: string | null
    founded_year: number | null
    country: string | null
    imageUrl: string | null
    genreName: string
  }

  const rows: EventRow[] = (events ?? []).map((e) => {
    const genre = Array.isArray(e.genre) ? e.genre[0] : e.genre
    return {
      id: e.id,
      name: e.name,
      event_type: e.event_type,
      founded_year: e.founded_year,
      country: e.country,
      imageUrl: e.image_url,
      genreName: genre?.name ?? NO_GENRE,
    }
  })

  // 大陸 → ジャンル → イベント一覧の階層にまとめる
  const byContinent = new Map<string, Map<string, EventRow[]>>()
  for (const row of rows) {
    const continent = continentForCountry(row.country)
    if (!byContinent.has(continent)) byContinent.set(continent, new Map())
    const byGenre = byContinent.get(continent)!
    if (!byGenre.has(row.genreName)) byGenre.set(row.genreName, [])
    byGenre.get(row.genreName)!.push(row)
  }

  const continentSections = CONTINENT_ORDER.filter((c) => byContinent.has(c)).map((continent) => ({
    continent,
    genres: Array.from(byContinent.get(continent)!.entries()).sort(([a], [b]) => {
      if (a === NO_GENRE) return 1
      if (b === NO_GENRE) return -1
      return a.localeCompare(b, 'ja')
    }),
  }))

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">フェス&イベント</h1>
      <p className="mt-2 text-sm text-white/50">大陸・ジャンル別にまとめたフェス・単発イベントの開催情報。</p>

      <form className="mt-6 flex flex-wrap gap-2" action="/events">
        <select
          name="event_type"
          defaultValue={eventType ?? ''}
          className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
        >
          <option value="">種別: すべて</option>
          {Object.entries(EVENT_TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85"
        >
          絞り込み
        </button>
      </form>

      {continentSections.length === 0 ? (
        <p className="mt-10 text-sm text-white/40">該当するイベントが登録されていません。</p>
      ) : (
        <div className="mt-10 space-y-10">
          {continentSections.map(({ continent, genres }) => (
            <section key={continent}>
              <h2 className="text-xl font-bold">{continent}</h2>
              <div className="mt-4 space-y-6">
                {genres.map(([genreName, genreEvents]) => (
                  <div key={genreName}>
                    <h3 className="text-xs font-medium uppercase tracking-wide text-white/40">{genreName}</h3>
                    <ul className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                      {genreEvents.map((e) => (
                        <li key={e.id}>
                          <Link href={`/events/${e.id}`} className="group block">
                            <div className="aspect-video overflow-hidden rounded-md border border-white/10 bg-white/5">
                              {e.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={e.imageUrl}
                                  alt={e.name}
                                  className="h-full w-full object-contain transition group-hover:opacity-80"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-2xl">🎪</div>
                              )}
                            </div>
                            <p className="mt-2 truncate text-sm font-medium group-hover:opacity-70">{e.name}</p>
                            <p className="text-xs text-white/40">
                              {e.event_type ? EVENT_TYPE_LABEL[e.event_type] ?? e.event_type : ''}
                              {e.founded_year ? ` · ${e.founded_year}年〜` : ''}
                            </p>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
