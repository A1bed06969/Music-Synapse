import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import type { MapMarker } from '@/app/map/LeafletMap'
import { findRelatedNews, formatRelativeTime } from '@/utils/newsParser'
import { fetchCachedNews } from '@/utils/newsCache'
import DetailPageShell from '@/app/components/detail/DetailPageShell'
import StickyMiniHeader from '@/app/components/detail/StickyMiniHeader'
import BackLink from '@/app/components/navigation/BackLink'
import EventIdentityPanel from '@/app/components/event-detail/EventIdentityPanel'
import EventScheduleView, { type Appearance, type EditionDateEntry } from './EventScheduleView'

const EVENT_TYPE_LABEL: Record<string, string> = {
  festival: 'フェス',
  one_off_live: '単発イベント',
  tour: 'ツアー',
  other: 'その他',
}

// DBにはJST(+09:00)付きで保存されているが、event_appearance.start_time/end_timeは
// timestamptz列のためSupabase/PostgRESTはUTCのISO文字列として返す(+09:00が
// 失われる)。素の.slice(11,16)だとUTC時刻がそのまま「JSTの時刻」として表示され、
// 実際より9時間早い時刻になってしまう(app/admin/data/events/appearance/[id]/edit/
// page.tsxのtoJstDatetimeLocalと対になる変換が必要)。
function toHHMM(isoStr: string): string {
  const date = new Date(isoStr)
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`
}

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ year?: string }>
}) {
  const { id } = await params
  const { year: yearParam } = await searchParams
  const supabase = await createClient()

  const { data: event, error } = await supabase
    .from('event')
    .select(
      'id, name, name_ja, event_type, founded_year, country, prefecture, description, official_youtube_url, official_site_url, image_url'
    )
    .eq('id', id)
    .single()

  if (error || !event) {
    notFound()
  }

  // イベント名をタイトルに含む記事を拾う。Vercel Cronが定期取得しDBへ
  // 書き込んだnews_itemテーブルを読むだけ(utils/newsCache.ts参照)
  const relatedNewsPromise = fetchCachedNews().then(({ items }) =>
    findRelatedNews(items, [event.name, event.name_ja].filter((k): k is string => Boolean(k)), 3)
  )

  const { data: editions } = await supabase
    .from('event_edition')
    .select('id, year, start_date, end_date, venue, description')
    .eq('event_id', id)
    .order('year', { ascending: false })

  const editionList = editions ?? []
  const requestedYear = yearParam ? Number(yearParam) : null
  const selectedEdition =
    (requestedYear ? editionList.find((ed) => ed.year === requestedYear) : null) ?? editionList[0] ?? null

  let appearances: Appearance[] = []
  let editionDates: EditionDateEntry[] = []

  if (selectedEdition) {
    const { data: editionDateRows } = await supabase
      .from('event_edition_date')
      .select('id, date, venue, region')
      .eq('event_edition_id', selectedEdition.id)
      .order('date', { ascending: true })
    editionDates = editionDateRows ?? []

    const { data: appearanceRows } = await supabase
      .from('event_appearance')
      .select('id, stage, venue, is_headliner, start_time, end_time, display_name, artist:artist_id(id, name, image_url)')
      .eq('event_edition_id', selectedEdition.id)
      .order('is_headliner', { ascending: false })
      .order('start_time', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })

    // 出演に紐づく全アーティスト(単独出演も含め、コラボの場合は2件以上)を
    // event_appearance_artist経由でまとめて取得し、event_appearance_idごとに束ねる
    const appearanceIds = (appearanceRows ?? []).map((row) => row.id)
    const artistsByAppearanceId = new Map<number, { id: string; name: string; imageUrl: string | null }[]>()
    if (appearanceIds.length > 0) {
      const { data: linkRows } = await supabase
        .from('event_appearance_artist')
        .select('event_appearance_id, billing_order, artist:artist_id(id, name, image_url)')
        .in('event_appearance_id', appearanceIds)
        .order('billing_order', { ascending: true })
      for (const link of linkRows ?? []) {
        const artist = Array.isArray(link.artist) ? link.artist[0] : link.artist
        if (!artist) continue
        const list = artistsByAppearanceId.get(link.event_appearance_id) ?? []
        list.push({ id: artist.id, name: artist.name, imageUrl: artist.image_url })
        artistsByAppearanceId.set(link.event_appearance_id, list)
      }
    }

    appearances = (appearanceRows ?? []).map((row) => {
      const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
      // 開催回登録時の仮時刻(正午固定)は「時刻不明」と同じ扱いにする
      const hasRealTime = row.start_time && row.end_time
      const linkedArtists = artistsByAppearanceId.get(row.id)
      const artists = linkedArtists && linkedArtists.length > 0 ? linkedArtists : [{ id: artist?.id ?? '', name: artist?.name ?? '?', imageUrl: artist?.image_url ?? null }]
      return {
        id: row.id,
        stage: row.stage,
        venue: row.venue ?? selectedEdition.venue ?? null,
        isHeadliner: row.is_headliner,
        performanceDate: row.start_time ? row.start_time.slice(0, 10) : null,
        timeLabel: hasRealTime ? `${toHHMM(row.start_time!)}-${toHHMM(row.end_time!)}` : null,
        displayName: row.display_name,
        artists,
        startTimeSort: hasRealTime ? row.start_time : null,
      }
    })
  }

  const venueSummary = selectedEdition
    ? (selectedEdition.venue ?? appearances.find((a) => a.venue)?.venue ?? null)
    : null

  // event_edition_date(個別日程・会場)が登録されている開催回は、会場ごとに
  // マーカーを分ける(サマーソニックのように複数会場になる場合があるため)。
  // 登録が無い開催回は従来通りvenueSummary(単一の会場文字列)で1件だけ表示する。
  let venueMarkers: MapMarker[] = []
  if (editionDates.length > 0) {
    const distinctVenues = Array.from(new Set(editionDates.map((ed) => ed.venue)))
    const { data: venueLocations } = await supabase
      .from('venue_location')
      .select('venue_name, latitude, longitude')
      .in('venue_name', distinctVenues)
    venueMarkers = (venueLocations ?? []).map((v) => ({
      id: `venue-${v.venue_name}`,
      latitude: v.latitude,
      longitude: v.longitude,
      color: '#e8a63c',
      popupHtml: v.venue_name,
      category: 'venue' as const,
      label: v.venue_name,
    }))
  } else if (venueSummary) {
    const { data: venueLocation } = await supabase
      .from('venue_location')
      .select('latitude, longitude')
      .eq('venue_name', venueSummary)
      .maybeSingle()
    if (venueLocation) {
      venueMarkers = [
        {
          id: 'venue',
          latitude: venueLocation.latitude,
          longitude: venueLocation.longitude,
          color: '#e8a63c',
          popupHtml: venueSummary,
          category: 'venue',
          label: venueSummary,
        },
      ]
    }
  }

  const relatedNews = await relatedNewsPromise

  const centerColumn = (
    <>
      {editionList.length === 0 || !selectedEdition ? (
        <p className="text-sm text-white/40">まだ開催情報が登録されていません。</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {editionList.map((ed) => (
              <Link
                key={ed.id}
                href={`/events/${id}?year=${ed.year}`}
                className={`rounded-full border px-3 py-1 text-xs ${
                  ed.year === selectedEdition.year
                    ? 'border-white bg-white text-black'
                    : 'border-white/15 text-white/60 hover:border-white/30'
                }`}
              >
                {ed.year}
              </Link>
            ))}
          </div>

          <EventScheduleView
            editionDates={editionDates}
            editionDescription={selectedEdition.description}
            venueSummary={venueSummary}
            editionStartDate={selectedEdition.start_date}
            editionEndDate={selectedEdition.end_date}
            venueMarkers={venueMarkers}
            appearances={appearances}
          />
        </>
      )}
    </>
  )

  const rightColumn = (
    <>
      {relatedNews.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold">関連ニュース</h2>
          <div className="mt-3 space-y-2">
            {relatedNews.map((item) => (
              <a
                key={item.id}
                href={item.link}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.03] p-2 transition hover:border-white/30 sm:block sm:overflow-hidden sm:rounded-lg sm:p-0"
              >
                <div className="h-12 w-16 shrink-0 overflow-hidden rounded bg-white/5 sm:aspect-video sm:h-auto sm:w-full sm:rounded-none">
                  {item.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-white/20 sm:text-xs">
                      No Image
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 sm:p-3">
                  <p className="line-clamp-2 text-xs font-medium leading-snug sm:text-sm">{item.title}</p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-white/40 sm:mt-2 sm:justify-between sm:text-xs">
                    <span>{item.source}</span>
                    <span>{formatRelativeTime(item.publishedAt)}</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  )

  return (
    <>
      <StickyMiniHeader
        watchElementId="event-header"
        imageUrl={event.image_url}
        title={event.name}
        subtitle={event.event_type ? EVENT_TYPE_LABEL[event.event_type] ?? event.event_type : null}
      />
      <DetailPageShell
        topBar={<BackLink fallbackHref="/events" fallbackLabel="イベント一覧" />}
        left={
          <EventIdentityPanel
            data={{
              name: event.name,
              eventTypeLabel: event.event_type ? EVENT_TYPE_LABEL[event.event_type] ?? event.event_type : null,
              foundedYear: event.founded_year,
              country: event.country,
              prefecture: event.prefecture,
              description: event.description,
              imageUrl: event.image_url,
              youtubeUrl: event.official_youtube_url,
              officialSiteUrl: event.official_site_url,
            }}
          />
        }
        center={centerColumn}
        right={rightColumn}
      />
    </>
  )
}
