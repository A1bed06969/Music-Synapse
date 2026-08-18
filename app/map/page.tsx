import { createClient } from '@/utils/Supabase/server'
import { normalizeVenueName } from '@/utils/textNormalize'
import TabbedMapView from './TabbedMapView'
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
    .select('id, name, image_url, origin_latitude, origin_longitude, origin_prefecture, hometown_city, hometown_country')
    .not('origin_latitude', 'is', null)
    .not('origin_longitude', 'is', null)

  const artistIds = (artists ?? []).map((a) => a.id)

  const albumsByArtist = new Map<string, { id: string; title: string; jacketUrl: string | null }[]>()

  if (artistIds.length > 0) {
    const albumResults = await Promise.all(
      artistIds.map((id) =>
        supabase
          .from('album')
          .select('id, title, jacket_url, release_date')
          .eq('artist_id', id)
          .order('release_date', { ascending: false, nullsFirst: false })
          .limit(3)
      )
    )
    artistIds.forEach((id, i) => {
      const rows = albumResults[i].data ?? []
      albumsByArtist.set(
        id,
        rows.map((album) => ({ id: album.id, title: album.title, jacketUrl: album.jacket_url }))
      )
    })
  }

  const artistMarkers: MapMarker[] = (artists ?? [])
    .filter((a) => a.origin_latitude != null && a.origin_longitude != null)
    .map((a) => {
      const albumsHtml = (albumsByArtist.get(a.id) ?? [])
        .map(
          (album) =>
            `<div style="margin-top:4px;font-size:12px;"><a href="/albums/${escapeHtml(album.id)}" style="color:inherit;">${
              album.jacketUrl
                ? `<img src="${escapeHtml(album.jacketUrl)}" alt="" style="width:32px;height:32px;object-fit:cover;border-radius:4px;vertical-align:middle;margin-right:4px;" />`
                : ''
            }${escapeHtml(album.title)}</a></div>`
        )
        .join('')
      const placeName = a.hometown_city ?? a.origin_prefecture
      const region = a.origin_prefecture ?? a.hometown_country ?? null
      return {
        id: `artist-${a.id}`,
        latitude: Number(a.origin_latitude),
        longitude: Number(a.origin_longitude),
        color: '#e85d5d',
        category: 'artist' as const,
        label: a.name,
        imageUrl: a.image_url,
        region,
        popupHtml: `<div style="min-width:160px;">${
          a.image_url
            ? `<img src="${escapeHtml(a.image_url)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:50%;" />`
            : ''
        }<div style="margin-top:4px;font-weight:bold;"><a href="/artists/${escapeHtml(a.id)}" style="color:inherit;">${escapeHtml(
          a.name
        )}</a></div>${
          placeName ? `<div style="font-size:12px;color:#aaa;">${escapeHtml(placeName)}</div>` : ''
        }${albumsHtml}</div>`,
      }
    })

  const { data: venueLocations } = await supabase.from('venue_location').select('id, venue_name, latitude, longitude')

  const [{ data: musicEvents }, { data: eventEditions }, { data: eventEditionDates }, { data: eventAppearances }] =
    await Promise.all([
      supabase.from('music_event').select('id, name, venue, artist_id'),
      supabase.from('event_edition').select('id, event_id, year, venue, event:event_id(name)'),
      supabase
        .from('event_edition_date')
        .select('id, venue, event_edition:event_edition_id(event_id, event:event_id(name))'),
      supabase
        .from('event_appearance')
        .select('id, venue, event_edition:event_edition_id(id, event_id, year, event:event_id(name))'),
    ])

  type VenueEventLink = { label: string; href: string }

  // 同じ会場で開催され続けているイベントは、開催年ごとにリンクを分けると
  // 「年によって会場が違うのでは」という誤解を招くため、イベント単位で1本に
  // まとめる(年ごとの切り替えはイベント詳細ページ側のタブに任せる)
  function eventsForVenue(normalizedName: string): VenueEventLink[] {
    const linksByKey = new Map<string, VenueEventLink>()

    for (const row of musicEvents ?? []) {
      if (!row.venue || normalizeVenueName(row.venue) !== normalizedName) continue
      if (!row.artist_id) continue
      linksByKey.set(`artist-${row.artist_id}`, { label: row.name, href: `/artists/${row.artist_id}` })
    }

    for (const row of eventEditions ?? []) {
      if (!row.venue || normalizeVenueName(row.venue) !== normalizedName) continue
      const event = Array.isArray(row.event) ? row.event[0] : row.event
      linksByKey.set(`event-${row.event_id}`, { label: event?.name ?? '?', href: `/events/${row.event_id}` })
    }

    for (const row of eventEditionDates ?? []) {
      if (!row.venue || normalizeVenueName(row.venue) !== normalizedName) continue
      const edition = Array.isArray(row.event_edition) ? row.event_edition[0] : row.event_edition
      if (!edition) continue
      const event = Array.isArray(edition.event) ? edition.event[0] : edition.event
      linksByKey.set(`event-${edition.event_id}`, { label: event?.name ?? '?', href: `/events/${edition.event_id}` })
    }

    for (const row of eventAppearances ?? []) {
      if (!row.venue || normalizeVenueName(row.venue) !== normalizedName) continue
      const edition = Array.isArray(row.event_edition) ? row.event_edition[0] : row.event_edition
      if (!edition) continue
      const event = Array.isArray(edition.event) ? edition.event[0] : edition.event
      linksByKey.set(`event-${edition.event_id}`, { label: event?.name ?? '?', href: `/events/${edition.event_id}` })
    }

    return Array.from(linksByKey.values())
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
      category: 'venue' as const,
      label: v.venue_name,
      popupHtml: `<div style="min-width:160px;"><div style="font-weight:bold;">${escapeHtml(
        v.venue_name
      )}</div>${linksHtml}</div>`,
    }
  })

  const { data: recordShops } = await supabase
    .from('recordshop')
    .select('id, name, address, official_site_url, hours, latitude, longitude')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)

  const shopMarkers: MapMarker[] = (recordShops ?? []).map((s) => {
    const detailsHtml = [
      s.address ? `<div style="font-size:12px;color:#aaa;">${escapeHtml(s.address)}</div>` : '',
      s.hours ? `<div style="margin-top:2px;font-size:12px;">${escapeHtml(s.hours)}</div>` : '',
      s.official_site_url
        ? `<div style="margin-top:4px;font-size:12px;"><a href="${escapeHtml(s.official_site_url)}">公式サイト</a></div>`
        : '',
    ].join('')
    return {
      id: `shop-${s.id}`,
      latitude: Number(s.latitude),
      longitude: Number(s.longitude),
      color: '#5ad66f',
      category: 'shop' as const,
      label: s.name,
      popupHtml: `<div style="min-width:160px;"><div style="font-weight:bold;"><a href="/shops/${escapeHtml(
        s.id
      )}" style="color:inherit;">${escapeHtml(s.name)}</a></div>${detailsHtml}</div>`,
    }
  })

  const { data: livehouses } = await supabase
    .from('livehouse')
    .select('id, name, address, url, hours, latitude, longitude')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)

  const livehouseMarkers: MapMarker[] = (livehouses ?? []).map((l) => {
    const detailsHtml = [
      l.address ? `<div style="font-size:12px;color:#aaa;">${escapeHtml(l.address)}</div>` : '',
      l.hours ? `<div style="margin-top:2px;font-size:12px;">${escapeHtml(l.hours)}</div>` : '',
      l.url
        ? `<div style="margin-top:4px;font-size:12px;"><a href="${escapeHtml(l.url)}">公式サイト</a></div>`
        : '',
    ].join('')
    return {
      id: `livehouse-${l.id}`,
      latitude: Number(l.latitude),
      longitude: Number(l.longitude),
      color: '#c77dff',
      category: 'venue' as const,
      label: l.name,
      popupHtml: `<div style="min-width:160px;"><div style="font-weight:bold;"><a href="/livehouses/${escapeHtml(
        l.id
      )}" style="color:inherit;">${escapeHtml(l.name)}</a></div>${detailsHtml}</div>`,
    }
  })

  const markers: MapMarker[] = [...artistMarkers, ...venueMarkers, ...shopMarkers, ...livehouseMarkers]

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">マップ</h1>
      <p className="mt-2 text-sm text-white/50">
        アーティストの出身地・結成地、ライブ会場(フェス会場・ライブハウス)、レコードショップをタブで切り替えて表示します。
      </p>
      <div className="mt-8">
        <TabbedMapView markers={markers} />
      </div>
    </div>
  )
}
