import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import type { MapMarker } from '@/app/map/LeafletMap'
import { findRelatedNews } from '@/utils/newsParser'
import { fetchCachedNews } from '@/utils/newsCache'
import type { Appearance, EditionDateEntry } from './EventScheduleView'
import EventDetailClient from './EventDetailClient'

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

  return (
    <EventDetailClient
      eventId={id}
      identity={{
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
      editionList={editionList.map((ed) => ({ id: ed.id, year: ed.year }))}
      selectedEditionYear={selectedEdition?.year ?? null}
      scheduleProps={
        selectedEdition
          ? {
              editionDates,
              editionDescription: selectedEdition.description,
              venueSummary,
              editionStartDate: selectedEdition.start_date,
              editionEndDate: selectedEdition.end_date,
              venueMarkers,
              appearances,
            }
          : null
      }
      relatedNews={relatedNews}
    />
  )
}
