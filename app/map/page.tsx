import { createClient } from '@/utils/Supabase/server'
import { normalizeVenueName } from '@/utils/textNormalize'
import MapClientWrapper from './MapClientWrapper'
import type { MapMarker } from './LeafletMap'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export default async function MapPage() {
  const supabase = await createClient()

  const { data: artists } = await supabase
    .from('artist')
    .select('id, name, image_url, origin_latitude, origin_longitude')
    .not('origin_latitude', 'is', null)
    .not('origin_longitude', 'is', null)

  const artistIds = (artists ?? []).map((a) => a.id)

  const { data: albums } = artistIds.length
    ? await supabase
        .from('album')
        .select('id, artist_id, title, jacket_url, release_date')
        .in('artist_id', artistIds)
        .order('release_date', { ascending: false, nullsFirst: false })
    : { data: [] as { id: string; artist_id: string; title: string; jacket_url: string | null }[] }

  const albumsByArtist = new Map<string, { id: string; title: string; jacketUrl: string | null }[]>()
  for (const album of albums ?? []) {
    const list = albumsByArtist.get(album.artist_id) ?? []
    if (list.length < 3) {
      list.push({ id: album.id, title: album.title, jacketUrl: album.jacket_url })
      albumsByArtist.set(album.artist_id, list)
    }
  }

  const artistMarkers: MapMarker[] = (artists ?? [])
    .filter((a) => a.origin_latitude != null && a.origin_longitude != null)
    .map((a) => {
      const albumsHtml = (albumsByArtist.get(a.id) ?? [])
        .map(
          (album) =>
            `<div style="margin-top:4px;font-size:12px;">${
              album.jacketUrl
                ? `<img src="${escapeHtml(album.jacketUrl)}" alt="" style="width:32px;height:32px;object-fit:cover;border-radius:4px;vertical-align:middle;margin-right:4px;" />`
                : ''
            }${escapeHtml(album.title)}</div>`
        )
        .join('')
      return {
        id: `artist-${a.id}`,
        latitude: Number(a.origin_latitude),
        longitude: Number(a.origin_longitude),
        color: '#e85d5d',
        popupHtml: `<div style="min-width:160px;">${
          a.image_url
            ? `<img src="${escapeHtml(a.image_url)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:50%;" />`
            : ''
        }<div style="margin-top:4px;font-weight:bold;"><a href="/artists/${escapeHtml(a.id)}" style="color:inherit;">${escapeHtml(
          a.name
        )}</a></div>${albumsHtml}</div>`,
      }
    })

  const { data: venueLocations } = await supabase.from('venue_location').select('id, venue_name, latitude, longitude')

  const [{ data: musicEvents }, { data: eventEditions }, { data: eventAppearances }] = await Promise.all([
    supabase.from('music_event').select('id, name, venue, artist_id'),
    supabase.from('event_edition').select('id, event_id, year, venue, event:event_id(name)'),
    supabase
      .from('event_appearance')
      .select('id, venue, event_edition:event_edition_id(id, event_id, year, event:event_id(name))'),
  ])

  type VenueEventLink = { label: string; href: string }

  function eventsForVenue(normalizedName: string): VenueEventLink[] {
    const links: VenueEventLink[] = []

    for (const row of musicEvents ?? []) {
      if (row.venue && normalizeVenueName(row.venue) === normalizedName) {
        links.push({ label: row.name, href: `/artists/${row.artist_id}` })
      }
    }

    for (const row of eventEditions ?? []) {
      if (row.venue && normalizeVenueName(row.venue) === normalizedName) {
        const event = Array.isArray(row.event) ? row.event[0] : row.event
        links.push({
          label: `${event?.name ?? '?'}(${row.year})`,
          href: `/events/${row.event_id}?year=${row.year}`,
        })
      }
    }

    for (const row of eventAppearances ?? []) {
      if (!row.venue || normalizeVenueName(row.venue) !== normalizedName) continue
      const edition = Array.isArray(row.event_edition) ? row.event_edition[0] : row.event_edition
      if (!edition) continue
      const event = Array.isArray(edition.event) ? edition.event[0] : edition.event
      links.push({
        label: `${event?.name ?? '?'}(${edition.year})`,
        href: `/events/${edition.event_id}?year=${edition.year}`,
      })
    }

    return links
  }

  const venueMarkers: MapMarker[] = (venueLocations ?? []).map((v) => {
    const normalizedName = normalizeVenueName(v.venue_name)
    const links = eventsForVenue(normalizedName)
    const linksHtml =
      links.length > 0
        ? links
            .map(
              (l) =>
                `<div style="margin-top:4px;font-size:12px;"><a href="${escapeHtml(l.href)}">${escapeHtml(
                  l.label
                )}</a></div>`
            )
            .join('')
        : '<div style="margin-top:4px;font-size:12px;color:#888;">開催イベント情報なし</div>'
    return {
      id: `venue-${v.id}`,
      latitude: Number(v.latitude),
      longitude: Number(v.longitude),
      color: '#5aa9e6',
      popupHtml: `<div style="min-width:160px;"><div style="font-weight:bold;">${escapeHtml(
        v.venue_name
      )}</div>${linksHtml}</div>`,
    }
  })

  const markers: MapMarker[] = [...artistMarkers, ...venueMarkers]

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-2xl font-bold">マップ</h1>
      <p className="mt-2 text-sm text-white/50">
        アーティストの出身地・結成地(赤)とイベント会場(青)を地図で表示します。
      </p>
      <div className="mt-8">
        <MapClientWrapper markers={markers} />
      </div>
    </div>
  )
}
