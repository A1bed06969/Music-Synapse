import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import CalendarView, { type CalendarAlbum, type CalendarLiveEvent } from './CalendarView'

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

export default async function AlbumCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month: monthParam } = await searchParams
  const currentMonth =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : new Date().toISOString().slice(0, 7)
  const { start, end } = monthRange(currentMonth)

  const supabase = await createClient()
  const { data: albumRows } = await supabase
    .from('album')
    .select('id, title, jacket_url, release_date, artist:artist_id(id, name)')
    .gte('release_date', start)
    .lt('release_date', end)
    .is('primary_album_id', null)
    .order('release_date', { ascending: true })

  const artistIds = Array.from(
    new Set(
      (albumRows ?? [])
        .map((a) => (Array.isArray(a.artist) ? a.artist[0] : a.artist)?.id)
        .filter((id): id is string => !!id)
    )
  )

  const { data: genreRows } = artistIds.length
    ? await supabase.from('artist_genre').select('artist_id, genre:genre_id(name)').in('artist_id', artistIds)
    : { data: [] }

  const genresByArtist = new Map<string, string[]>()
  for (const row of genreRows ?? []) {
    const genre = Array.isArray(row.genre) ? row.genre[0] : row.genre
    if (!genre?.name) continue
    const list = genresByArtist.get(row.artist_id) ?? []
    list.push(genre.name)
    genresByArtist.set(row.artist_id, list)
  }

  const albums: CalendarAlbum[] = (albumRows ?? [])
    .filter((a) => !!a.release_date)
    .map((a) => {
      const artist = Array.isArray(a.artist) ? a.artist[0] : a.artist
      return {
        id: a.id,
        title: a.title,
        jacketUrl: a.jacket_url,
        releaseDate: a.release_date as string,
        artistName: artist?.name ?? '不明',
        genres: artist ? genresByArtist.get(artist.id) ?? [] : [],
      }
    })

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

  const events: CalendarLiveEvent[] = [...festivalEvents, ...liveEvents]

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">新譜カレンダー</h1>
          <p className="mt-2 text-sm text-white/50">
            リリース日ごとに新譜をカレンダー表示します。日付をクリックすると詳細が表示されます。
          </p>
        </div>
        <Link href="/albums" className="text-xs text-white/40 hover:text-white/70">
          ← アルバム一覧に戻る
        </Link>
      </div>

      <CalendarView
        month={currentMonth}
        monthLabel={monthLabel(currentMonth)}
        prevMonthHref={`/albums/calendar?month=${shiftMonth(currentMonth, -1)}`}
        nextMonthHref={`/albums/calendar?month=${shiftMonth(currentMonth, 1)}`}
        albums={albums}
        events={events}
      />
    </div>
  )
}
