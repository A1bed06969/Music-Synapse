import type { createClient } from '@/utils/Supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/** 直近の「朝8時(JST)」の時刻をISO文字列で返す。現在がJSTで8時以降ならその日の
 * 8時、8時より前ならまだ前日分の集計期間が続いているとみなして前日の8時を返す。
 * サーバーはUTCで動くため、utils/homeCards.tsのtomorrowJST()と同じ「+9時間して
 * UTCゲッターでJST値を読む」パターンを使う。 */
export function mostRecentEightAmJST(): string {
  const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const y = nowJST.getUTCFullYear()
  const m = nowJST.getUTCMonth()
  const d = nowJST.getUTCDate()
  const boundaryDay = nowJST.getUTCHours() >= 8 ? d : d - 1
  // JST 8:00のその瞬間 = UTCでは9時間前
  return new Date(Date.UTC(y, m, boundaryDay, 8, 0, 0) - 9 * 60 * 60 * 1000).toISOString()
}

export type NewArrivalsSummary = {
  boundary: string
  artistCount: number
  albumCount: number
  trackCount: number
  eventCount: number
  curationCount: number
}

/** ホーム画面ウィジェット用。件数だけを軽量に取得する。 */
export async function fetchNewArrivalsSummary(supabase: Supabase): Promise<NewArrivalsSummary> {
  const boundary = mostRecentEightAmJST()

  const [artist, album, track, event, curation] = await Promise.all([
    supabase.from('artist').select('id', { count: 'exact', head: true }).gte('created_at', boundary),
    supabase.from('album').select('id', { count: 'exact', head: true }).gte('created_at', boundary),
    supabase.from('track').select('id', { count: 'exact', head: true }).gte('created_at', boundary),
    supabase.from('event_appearance_artist').select('id', { count: 'exact', head: true }).gte('created_at', boundary),
    supabase.from('ranking_entry').select('id', { count: 'exact', head: true }).gte('created_at', boundary),
  ])

  return {
    boundary,
    artistCount: artist.count ?? 0,
    albumCount: album.count ?? 0,
    trackCount: track.count ?? 0,
    eventCount: event.count ?? 0,
    curationCount: curation.count ?? 0,
  }
}

export type NewArtistItem = { id: string; name: string; imageUrl: string | null }
export type NewAlbumItem = { id: string; title: string; jacketUrl: string | null; artistName: string }
export type NewTrackItem = { id: string; title: string; artistName: string; albumTitle: string | null }
export type NewEventItem = { id: string; artistId: string; artistName: string; eventName: string }
export type NewCurationItem = { id: number; rankingName: string; targetLabel: string }

export type NewArrivalsCounts = {
  artist: number
  album: number
  track: number
  event: number
  curation: number
}

export type NewArrivalsDetail = {
  boundary: string
  /** カテゴリごとの正確な総数(PostgRESTの1行取得上限に左右されない、count:'exact'によるもの) */
  counts: NewArrivalsCounts
  /** 一覧表示用。DETAIL_LIST_LIMIT件までに絞っている(countsとは別物)。 */
  artists: NewArtistItem[]
  albums: NewAlbumItem[]
  tracks: NewTrackItem[]
  events: NewEventItem[]
  curationEntries: NewCurationItem[]
}

// 一覧に表示する件数の上限。1000件超のカテゴリでも一覧は絞ってよいとのことなので、
// 表示用リストはこの件数までに留める(正確な総数はcountsで別途取得する)。
const DETAIL_LIST_LIMIT = 300

/** 詳細ページ用。各カテゴリの正確な総数と、新しい順の一覧(最大DETAIL_LIST_LIMIT件)を取得する。 */
export async function fetchNewArrivalsDetail(supabase: Supabase): Promise<NewArrivalsDetail> {
  const boundary = mostRecentEightAmJST()

  const [artistCountRes, albumCountRes, trackCountRes, eventCountRes, curationCountRes, artistRes, albumRes, trackRes, eventRes, curationRes] =
    await Promise.all([
      supabase.from('artist').select('id', { count: 'exact', head: true }).gte('created_at', boundary),
      supabase.from('album').select('id', { count: 'exact', head: true }).gte('created_at', boundary),
      supabase.from('track').select('id', { count: 'exact', head: true }).gte('created_at', boundary),
      supabase
        .from('event_appearance_artist')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', boundary),
      supabase.from('ranking_entry').select('id', { count: 'exact', head: true }).gte('created_at', boundary),
      supabase
        .from('artist')
        .select('id, name, image_url')
        .gte('created_at', boundary)
        .order('created_at', { ascending: false })
        .limit(DETAIL_LIST_LIMIT),
      supabase
        .from('album')
        .select('id, title, jacket_url, artist:artist_id(name)')
        .gte('created_at', boundary)
        .order('created_at', { ascending: false })
        .limit(DETAIL_LIST_LIMIT),
      supabase
        .from('track')
        .select('id, title, artist:artist_id(name), album:album_id(title, artist:artist_id(name))')
        .gte('created_at', boundary)
        .order('created_at', { ascending: false })
        .limit(DETAIL_LIST_LIMIT),
      supabase
        .from('event_appearance_artist')
        .select(
          'id, artist:artist_id(id, name), event_appearance:event_appearance_id(event_edition:event_edition_id(event:event_id(name, name_ja)))'
        )
        .gte('created_at', boundary)
        .order('created_at', { ascending: false })
        .limit(DETAIL_LIST_LIMIT),
      supabase
        .from('ranking_entry')
        .select(
          'id, ranking:ranking_id(name), track:track_id(title), album:album_id(title), artist:artist_id(name)'
        )
        .gte('created_at', boundary)
        .order('created_at', { ascending: false })
        .limit(DETAIL_LIST_LIMIT),
    ])

  const counts: NewArrivalsCounts = {
    artist: artistCountRes.count ?? 0,
    album: albumCountRes.count ?? 0,
    track: trackCountRes.count ?? 0,
    event: eventCountRes.count ?? 0,
    curation: curationCountRes.count ?? 0,
  }

  const artists: NewArtistItem[] = (artistRes.data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    imageUrl: a.image_url,
  }))

  const albums: NewAlbumItem[] = (albumRes.data ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    jacketUrl: a.jacket_url,
    artistName: firstOf(a.artist)?.name ?? '不明',
  }))

  const tracks: NewTrackItem[] = (trackRes.data ?? []).map((t) => {
    const directArtist = firstOf(t.artist)
    const album = firstOf(t.album)
    const albumArtist = album ? firstOf(album.artist) : null
    return {
      id: t.id,
      title: t.title,
      artistName: directArtist?.name ?? albumArtist?.name ?? '不明',
      albumTitle: album?.title ?? null,
    }
  })

  const events: NewEventItem[] = (eventRes.data ?? [])
    .map((row) => {
      const artist = firstOf(row.artist)
      const appearance = firstOf(row.event_appearance)
      const edition = appearance ? firstOf(appearance.event_edition) : null
      const ev = edition ? firstOf(edition.event) : null
      if (!artist || !ev) return null
      return {
        id: String(row.id),
        artistId: artist.id,
        artistName: artist.name,
        eventName: ev.name || ev.name_ja || '(名称不明)',
      }
    })
    .filter((e): e is NewEventItem => e !== null)

  const curationEntries: NewCurationItem[] = (curationRes.data ?? []).map((row) => {
    const ranking = firstOf(row.ranking)
    const track = firstOf(row.track)
    const album = firstOf(row.album)
    const artist = firstOf(row.artist)
    return {
      id: row.id,
      rankingName: ranking?.name ?? '不明',
      targetLabel: track?.title ?? album?.title ?? artist?.name ?? '—',
    }
  })

  return { boundary, counts, artists, albums, tracks, events, curationEntries }
}
