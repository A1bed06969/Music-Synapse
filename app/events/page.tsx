import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { continentForCountry, CONTINENT_ORDER } from '@/utils/continents'
import { normalizeVenueName } from '@/utils/textNormalize'
import { escapeHtml } from '@/utils/format'
import MapClientWrapper from '@/app/map/MapClientWrapper'
import type { MapMarker } from '@/app/map/LeafletMap'
import EventCalendarView, { type CalendarLiveEvent } from './EventCalendarView'

function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const nextMonthDate = new Date(Date.UTC(y, m, 1))
  const end = nextMonthDate.toISOString().slice(0, 10)
  return { start, end }
}

function addOneDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

// フェスの開催期間(start_date〜end_date)を、月表示の範囲内に収まる日ごとに
// 展開する。複数日開催のフェスは該当する日すべてにマーカーを付けるため。
function expandDateRange(rangeStart: string, rangeEnd: string, monthStart: string, monthEndExclusive: string): string[] {
  const clampedStart = rangeStart < monthStart ? monthStart : rangeStart
  const rangeEndExclusive = addOneDay(rangeEnd)
  const clampedEndExclusive = rangeEndExclusive > monthEndExclusive ? monthEndExclusive : rangeEndExclusive

  const days: string[] = []
  let cur = clampedStart
  while (cur < clampedEndExclusive) {
    days.push(cur)
    cur = addOneDay(cur)
  }
  return days
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthLabel(month: string) {
  const [y, m] = month.split('-')
  return `${y}年${Number(m)}月`
}

/** カレンダー表示用: フェス(event_edition/event_edition_date)とライブ(music_event)を
 * 月範囲で取得する。もともと/albums/calendarにあった機能をこちらへ移管したもの
 * (新譜カレンダーは新譜専用に戻し、フェス・ライブはFes & Live Freak側で扱う)。 */
async function fetchMonthEvents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  month: string
): Promise<CalendarLiveEvent[]> {
  const { start, end } = monthRange(month)

  // フェス: event_edition_date(開催回内の個別日程+会場)があればそれを優先する。
  // サマーソニックのように日によって会場が異なる場合でも正しく表示できる。
  // 個別日程が1件も無い開催回(既存データ)は、従来通りevent_editionの
  // start_date〜end_dateの範囲展開にフォールバックする。
  const { data: editionDateRows } = await supabase
    .from('event_edition_date')
    .select(
      'id, event_edition_id, date, venue, event_edition:event_edition_id(event:event_id(id, name, name_ja, image_url))'
    )
    .gte('date', start)
    .lt('date', end)

  const { data: allEditionDateRows } = await supabase.from('event_edition_date').select('event_edition_id')
  const editionsWithDates = new Set((allEditionDateRows ?? []).map((r) => r.event_edition_id))

  const festivalEventsFromDates: CalendarLiveEvent[] = (editionDateRows ?? []).map((row) => {
    const edition = Array.isArray(row.event_edition) ? row.event_edition[0] : row.event_edition
    const ev = edition ? (Array.isArray(edition.event) ? edition.event[0] : edition.event) : null
    return {
      id: row.id,
      date: row.date,
      kind: 'event' as const,
      // event.nameが正式名称(例: "FUJI ROCK FESTIVAL")、name_jaは通称
      // (例: "フジロック")。/events・/events/[id]と同じくnameを主表示にする。
      title: ev?.name || ev?.name_ja || '(名称不明)',
      imageUrl: ev?.image_url ?? null,
      venue: row.venue,
      artistName: null,
      href: ev?.id ? `/events/${ev.id}` : null,
    }
  })

  // フェス(フォールバック): 個別日程(event_edition_date)が無い開催回のみ、
  // 開始日<月末 かつ 終了日>=月初 で範囲重複判定して期間全体を展開する。
  const { data: editionRows } = await supabase
    .from('event_edition')
    .select('id, start_date, end_date, venue, event:event_id(id, name, name_ja, image_url, event_type)')
    .lt('start_date', end)
    .gte('end_date', start)

  const festivalEventsFromRange: CalendarLiveEvent[] = (editionRows ?? [])
    .filter((edition) => !editionsWithDates.has(edition.id))
    .flatMap((edition) => {
      if (!edition.start_date || !edition.end_date) return []
      const ev = Array.isArray(edition.event) ? edition.event[0] : edition.event
      const days = expandDateRange(edition.start_date, edition.end_date, start, end)
      return days.map((date) => ({
        id: `${edition.id}-${date}`,
        date,
        kind: 'event' as const,
        title: ev?.name || ev?.name_ja || '(名称不明)',
        imageUrl: ev?.image_url ?? null,
        venue: edition.venue,
        artistName: null,
        href: ev?.id ? `/events/${ev.id}` : null,
      }))
    })

  const festivalEvents: CalendarLiveEvent[] = [...festivalEventsFromDates, ...festivalEventsFromRange]

  // ライブ: music_event(単発の開催日)を月表示の範囲で取得。
  const { data: liveRows } = await supabase
    .from('music_event')
    .select('id, name, event_date, venue, artist:artist_id(id, name)')
    .gte('event_date', start)
    .lt('event_date', end)
    .order('event_date', { ascending: true })

  const liveEvents: CalendarLiveEvent[] = (liveRows ?? [])
    .filter((l) => !!l.event_date)
    .map((l) => {
      const artist = Array.isArray(l.artist) ? l.artist[0] : l.artist
      return {
        id: l.id,
        date: l.event_date as string,
        kind: 'live' as const,
        title: l.name ?? artist?.name ?? '(名称不明)',
        imageUrl: null,
        venue: l.venue,
        artistName: artist?.name ?? null,
        href: null,
      }
    })

  return [...festivalEvents, ...liveEvents]
}

type UpcomingVenueEvent = { key: string; label: string; href: string; imageUrl: string | null; dates: string[] }

/** マップ表示用: 今日以降に開催予定のフェス・ライブの会場をvenue_location(ジオコード済み
 * 会場マスタ、/mapページと共通)と突き合わせてマーカー化する。開催日を跨がず月に縛られず
 * 「今後すべて」を対象にする(カレンダー表示は月単位のfetchMonthEventsを使う)。 */
async function fetchUpcomingVenueMarkers(supabase: Awaited<ReturnType<typeof createClient>>): Promise<MapMarker[]> {
  const today = new Date().toISOString().slice(0, 10)

  const [{ data: venueLocations }, { data: editionDateRows }, { data: allEditionDateRows }, { data: liveRows }] =
    await Promise.all([
      supabase.from('venue_location').select('id, venue_name, latitude, longitude'),
      supabase
        .from('event_edition_date')
        .select(
          'id, event_edition_id, date, venue, event_edition:event_edition_id(event:event_id(id, name, name_ja, image_url))'
        )
        .gte('date', today)
        .order('date', { ascending: true }),
      supabase.from('event_edition_date').select('event_edition_id'),
      supabase
        .from('music_event')
        .select('id, name, event_date, venue, artist:artist_id(id, name)')
        .gte('event_date', today)
        .order('event_date', { ascending: true }),
    ])

  const editionsWithDates = new Set((allEditionDateRows ?? []).map((r) => r.event_edition_id))

  const { data: editionRows } = await supabase
    .from('event_edition')
    .select('id, end_date, venue, event:event_id(id, name, name_ja, image_url)')
    .gte('end_date', today)

  // 同じフェス(event)が複数日程(event_edition_date)を持つ場合、日程ごとに別カードに
  // ならないよう「会場+イベント」単位で1件にまとめ、日付だけ配列で積み上げる
  const eventsByVenue = new Map<string, Map<string, UpcomingVenueEvent>>()
  function addDate(venue: string | null, key: string, base: Omit<UpcomingVenueEvent, 'dates'>, date: string) {
    if (!venue) return
    const venueKey = normalizeVenueName(venue)
    const venueEvents = eventsByVenue.get(venueKey) ?? new Map<string, UpcomingVenueEvent>()
    const existing = venueEvents.get(key)
    if (existing) {
      if (!existing.dates.includes(date)) existing.dates.push(date)
    } else {
      venueEvents.set(key, { ...base, dates: [date] })
    }
    eventsByVenue.set(venueKey, venueEvents)
  }

  for (const row of editionDateRows ?? []) {
    const edition = Array.isArray(row.event_edition) ? row.event_edition[0] : row.event_edition
    const ev = edition ? (Array.isArray(edition.event) ? edition.event[0] : edition.event) : null
    if (!ev?.id) continue
    addDate(
      row.venue,
      `event-${ev.id}`,
      { key: `event-${ev.id}`, label: ev.name || ev.name_ja || '(名称不明)', href: `/events/${ev.id}`, imageUrl: ev.image_url ?? null },
      row.date
    )
  }

  for (const edition of editionRows ?? []) {
    if (editionsWithDates.has(edition.id)) continue
    const ev = Array.isArray(edition.event) ? edition.event[0] : edition.event
    if (!ev?.id) continue
    addDate(
      edition.venue,
      `event-${ev.id}`,
      { key: `event-${ev.id}`, label: ev.name || ev.name_ja || '(名称不明)', href: `/events/${ev.id}`, imageUrl: ev.image_url ?? null },
      edition.end_date
    )
  }

  for (const l of liveRows ?? []) {
    if (!l.event_date) continue
    const artist = Array.isArray(l.artist) ? l.artist[0] : l.artist
    addDate(
      l.venue,
      `live-${l.id}`,
      {
        key: `live-${l.id}`,
        label: l.name ?? artist?.name ?? '(名称不明)',
        href: artist?.id ? `/artists/${artist.id}` : '',
        imageUrl: null,
      },
      l.event_date
    )
  }

  const markers: MapMarker[] = []
  for (const v of venueLocations ?? []) {
    const events = eventsByVenue.get(normalizeVenueName(v.venue_name))
    if (!events || events.size === 0) continue

    const eventsHtml = Array.from(events.values())
      .map((e) => {
        const datesLabel = e.dates.slice().sort().join(' / ')
        return `<div style="margin-top:6px;"><a href="${escapeHtml(e.href)}" style="color:inherit;display:block;">${
          e.imageUrl
            ? `<img src="${escapeHtml(e.imageUrl)}" alt="" style="width:100%;height:auto;max-height:160px;object-fit:cover;border-radius:4px;display:block;" />`
            : ''
        }<div style="margin-top:4px;font-size:12px;">${escapeHtml(e.label)}</div><div style="font-size:11px;color:#888;">${escapeHtml(
          datesLabel
        )}</div></a></div>`
      })
      .join('')

    markers.push({
      id: `venue-${v.id}`,
      latitude: Number(v.latitude),
      longitude: Number(v.longitude),
      color: '#5aa9e6',
      category: 'venue',
      label: v.venue_name,
      popupHtml: `<div style="width:220px;"><div style="font-weight:bold;">${escapeHtml(v.venue_name)}</div>${eventsHtml}</div>`,
    })
  }

  return markers
}

const EVENT_TYPE_LABEL: Record<string, string> = {
  festival: 'フェス',
  one_off_live: '単発イベント',
  tour: 'ツアー',
  other: 'その他',
}

const NO_GENRE = 'ジャンル未設定'

type EventCardRow = {
  id: string
  name: string
  event_type: string | null
  founded_year: number | null
  country: string | null
  imageUrl: string | null
  genreName: string
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ event_type?: string; view?: string; month?: string }>
}) {
  const { event_type: eventType, view, month: monthParam } = await searchParams
  const supabase = await createClient()
  const isCalendarView = view === 'calendar'
  const isMapView = view === 'map'
  const currentMonth = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : new Date().toISOString().slice(0, 7)

  const viewToggle = (
    <div className="mt-4 flex gap-1 border-b border-white/10 pb-2">
      <Link
        href="/events"
        className={`rounded px-3 py-1.5 text-sm transition ${!isCalendarView && !isMapView ? 'bg-white text-black' : 'text-white/60 hover:text-white'}`}
      >
        一覧
      </Link>
      <Link
        href={`/events?view=calendar&month=${currentMonth}`}
        className={`rounded px-3 py-1.5 text-sm transition ${isCalendarView ? 'bg-white text-black' : 'text-white/60 hover:text-white'}`}
      >
        カレンダー
      </Link>
      <Link
        href="/events?view=map"
        className={`rounded px-3 py-1.5 text-sm transition ${isMapView ? 'bg-white text-black' : 'text-white/60 hover:text-white'}`}
      >
        マップ
      </Link>
    </div>
  )

  if (isCalendarView) {
    const monthEvents = await fetchMonthEvents(supabase, currentMonth)
    return (
      <div className="mx-auto max-w-[1600px] px-6 py-12">
        <h1 className="text-2xl font-bold">フェス&イベント</h1>
        <p className="mt-2 text-sm text-white/50">国内外のフェス・ライブをカレンダー表示します。日付をクリックすると詳細が表示されます。</p>
        {viewToggle}
        <EventCalendarView
          month={currentMonth}
          monthLabel={monthLabel(currentMonth)}
          prevMonthHref={`/events?view=calendar&month=${shiftMonth(currentMonth, -1)}`}
          nextMonthHref={`/events?view=calendar&month=${shiftMonth(currentMonth, 1)}`}
          events={monthEvents}
        />
      </div>
    )
  }

  if (isMapView) {
    const venueMarkers = await fetchUpcomingVenueMarkers(supabase)
    return (
      <div className="mx-auto max-w-[1600px] px-6 py-12">
        <h1 className="text-2xl font-bold">フェス&イベント</h1>
        <p className="mt-2 text-sm text-white/50">今後開催予定のフェス・ライブの会場を地図上にプロットします。</p>
        {viewToggle}
        <div className="mt-6">
          {venueMarkers.length === 0 ? (
            <p className="mt-10 text-sm text-white/40">今後開催予定で会場の位置情報が登録されているイベントがありません。</p>
          ) : (
            <MapClientWrapper markers={venueMarkers} heightClassName="h-[600px]" />
          )}
        </div>
      </div>
    )
  }

  let query = supabase
    .from('event')
    .select('id, name, event_type, founded_year, country, image_url, genre:genre_id(name)')
    .order('name')

  if (eventType) query = query.eq('event_type', eventType)

  const { data: events } = await query

  const rows: EventCardRow[] = (events ?? []).map((e) => {
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

  function sortGenreEntries(entries: [string, EventCardRow[]][]) {
    return entries.sort(([a], [b]) => {
      if (a === NO_GENRE) return 1
      if (b === NO_GENRE) return -1
      return a.localeCompare(b, 'ja')
    })
  }

  // ジャンル → イベント一覧の階層にまとめる(国内セクション用、大陸分けは不要)
  function groupByGenre(targetRows: EventCardRow[]) {
    const byGenre = new Map<string, EventCardRow[]>()
    for (const row of targetRows) {
      if (!byGenre.has(row.genreName)) byGenre.set(row.genreName, [])
      byGenre.get(row.genreName)!.push(row)
    }
    return sortGenreEntries(Array.from(byGenre.entries()))
  }

  // 大陸 → ジャンル → イベント一覧の階層にまとめる(海外セクション用)
  function groupByContinentAndGenre(targetRows: EventCardRow[]) {
    const byContinent = new Map<string, Map<string, EventCardRow[]>>()
    for (const row of targetRows) {
      const continent = continentForCountry(row.country)
      if (!byContinent.has(continent)) byContinent.set(continent, new Map())
      const byGenre = byContinent.get(continent)!
      if (!byGenre.has(row.genreName)) byGenre.set(row.genreName, [])
      byGenre.get(row.genreName)!.push(row)
    }

    return CONTINENT_ORDER.filter((c) => byContinent.has(c)).map((continent) => ({
      continent,
      genres: sortGenreEntries(Array.from(byContinent.get(continent)!.entries())),
    }))
  }

  function isDomestic(country: string | null) {
    return country === '日本' || country === 'Japan'
  }

  // フェス・単発イベント(tour以外)とツアーを分けて表示する
  const tourRows = rows.filter((r) => r.event_type === 'tour')
  const festivalRows = rows.filter((r) => r.event_type !== 'tour')

  function buildDomesticOverseasSections(targetRows: EventCardRow[]) {
    const domesticRows = targetRows.filter((r) => isDomestic(r.country))
    const overseasRows = targetRows.filter((r) => !isDomestic(r.country))
    return {
      domesticGenres: groupByGenre(domesticRows),
      overseasContinents: groupByContinentAndGenre(overseasRows),
    }
  }

  const categorySections = [
    { label: 'フェス・イベント', ...buildDomesticOverseasSections(festivalRows) },
    { label: 'ツアー', ...buildDomesticOverseasSections(tourRows) },
  ].filter((c) => c.domesticGenres.length > 0 || c.overseasContinents.length > 0)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">フェス&イベント</h1>
      <p className="mt-2 text-sm text-white/50">大陸・ジャンル別にまとめたフェス・単発イベントの開催情報。</p>
      {viewToggle}

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

      {categorySections.length === 0 ? (
        <p className="mt-10 text-sm text-white/40">該当するイベントが登録されていません。</p>
      ) : (
        <div className="mt-12 space-y-14">
          {categorySections.map(({ label, domesticGenres, overseasContinents }) => (
            <section key={label}>
              <h2 className="text-2xl font-bold">{label}</h2>
              <div className="mt-6 space-y-10">
                {domesticGenres.length > 0 && (
                  <section>
                    <h3 className="text-xl font-bold">国内</h3>
                    <div className="mt-4">
                      <GenreGroups genres={domesticGenres} />
                    </div>
                  </section>
                )}
                {overseasContinents.length > 0 && (
                  <section>
                    <h3 className="text-xl font-bold">海外</h3>
                    <div className="mt-4 space-y-8">
                      {overseasContinents.map(({ continent, genres }) => (
                        <div key={continent}>
                          <h4 className="text-sm font-semibold text-white/70">{continent}</h4>
                          <div className="mt-3">
                            <GenreGroups genres={genres} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function GenreGroups({ genres }: { genres: [string, EventCardRow[]][] }) {
  return (
    <div className="space-y-6">
      {genres.map(([genreName, genreEvents]) => (
        <div key={genreName}>
          <h5 className="text-xs font-medium uppercase tracking-wide text-white/40">{genreName}</h5>
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
  )
}
