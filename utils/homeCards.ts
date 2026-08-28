import type { createClient } from '@/utils/Supabase/server'
import type { PrefectureEntry, PrefectureMapData } from '@/app/components/PrefectureMap'

type Supabase = Awaited<ReturnType<typeof createClient>>

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

// サーバーはUTCで動くため、単純にDate.now()+24hしても「JSTでの翌日」には
// ならない(utils/artistTimeline.tsと同じJST変換パターンを使う)
function tomorrowJST(): string {
  const todayJST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const [y, m, d] = todayJST.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

export type UpcomingAlbumCard = {
  id: string
  title: string
  jacketUrl: string | null
  releaseDate: string
  artistName: string
}

/** ①Discover New Music: 明日以降にリリースされる新譜を発売日の早い順に取得 */
export async function fetchUpcomingAlbums(supabase: Supabase, limit: number): Promise<UpcomingAlbumCard[]> {
  const tomorrow = tomorrowJST()

  const { data } = await supabase
    .from('album')
    .select('id, title, jacket_url, release_date, artist:artist_id(name)')
    .gte('release_date', tomorrow)
    .is('primary_album_id', null)
    .order('release_date', { ascending: true })
    .limit(limit)

  return (data ?? []).map((a) => {
    const artist = firstOf(a.artist)
    return {
      id: a.id,
      title: a.title,
      jacketUrl: a.jacket_url,
      releaseDate: a.release_date as string,
      artistName: artist?.name ?? '不明',
    }
  })
}

export type UpcomingFestivalCard = {
  id: string
  name: string
  imageUrl: string | null
  startDate: string
  endDate: string
  venue: string | null
}

/** ②Fes & Live Freak: 明日以降に開催されるフェスを開催日の早い順に取得。
 * 同じイベントの複数日程は1枚のカードにまとめる(events?view=mapと同じ考え方)。 */
export async function fetchUpcomingFestivals(supabase: Supabase, limit: number): Promise<UpcomingFestivalCard[]> {
  const tomorrow = tomorrowJST()

  const [{ data: editionDateRows }, { data: allEditionDateRows }, { data: editionRows }] = await Promise.all([
    supabase
      .from('event_edition_date')
      .select('event_edition_id, date, venue, event_edition:event_edition_id(event:event_id(id, name, name_ja, image_url))')
      .gte('date', tomorrow)
      .order('date', { ascending: true }),
    supabase.from('event_edition_date').select('event_edition_id'),
    supabase
      .from('event_edition')
      .select('id, start_date, end_date, venue, event:event_id(id, name, name_ja, image_url)')
      .gte('end_date', tomorrow),
  ])

  const editionsWithDates = new Set((allEditionDateRows ?? []).map((r) => r.event_edition_id))

  const byEvent = new Map<string, UpcomingFestivalCard>()

  for (const row of editionDateRows ?? []) {
    const edition = firstOf(row.event_edition)
    const ev = edition ? firstOf(edition.event) : null
    if (!ev?.id || !row.date) continue
    const existing = byEvent.get(ev.id)
    if (existing) {
      if (row.date < existing.startDate) existing.startDate = row.date
      if (row.date > existing.endDate) existing.endDate = row.date
    } else {
      byEvent.set(ev.id, {
        id: ev.id,
        name: ev.name || ev.name_ja || '(名称不明)',
        imageUrl: ev.image_url ?? null,
        startDate: row.date,
        endDate: row.date,
        venue: row.venue,
      })
    }
  }

  for (const edition of editionRows ?? []) {
    if (editionsWithDates.has(edition.id)) continue
    const ev = firstOf(edition.event)
    if (!ev?.id || !edition.start_date || !edition.end_date) continue
    const startDate = edition.start_date < tomorrow ? tomorrow : edition.start_date
    const existing = byEvent.get(ev.id)
    if (!existing) {
      byEvent.set(ev.id, {
        id: ev.id,
        name: ev.name || ev.name_ja || '(名称不明)',
        imageUrl: ev.image_url ?? null,
        startDate,
        endDate: edition.end_date,
        venue: edition.venue,
      })
    }
  }

  return Array.from(byEvent.values())
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, limit)
}

export type PowerPlayTopEntry = {
  key: string
  label: string
  sub: string | null
  href: string
  artistId: string | null
  artistImageUrl: string | null
  mediaCount: number
}

export type PowerPlayMonthData = {
  top: PowerPlayTopEntry[]
  prefectureData: PrefectureMapData[]
}

// PostgRESTの1000件上限を超えないようページングして取得する
// (app/media/on-air/page.tsxのfetchAllMonthRowsと同じ理由)
async function fetchAllMonthRotationRows(supabase: Supabase, monthStart: string, monthEnd: string) {
  const pageSize = 1000
  const query = (page: number) =>
    supabase
      .from('radio_rotation')
      .select(
        `track_id, album_id, artist_id, music_type,
         media_program:media_program_id(media_id, media:media_id(name, prefecture)),
         track:track_id(id, title, artist:artist_id(id, name, image_url), album:album_id(jacket_url)),
         album:album_id(id, title, artist:artist_id(id, name, image_url)),
         artist:artist_id(id, name, image_url)`
      )
      .gte('period_start_date', monthStart)
      .lt('period_start_date', monthEnd)
      .range(page * pageSize, page * pageSize + pageSize - 1)

  const { data: firstPage } = await query(0)
  const rows = [...(firstPage ?? [])]
  let hasMore = (firstPage?.length ?? 0) === pageSize
  let page = 1
  while (hasMore) {
    const { data } = await query(page)
    if (!data || data.length === 0) break
    rows.push(...data)
    hasMore = data.length === pageSize
    page++
  }
  return rows
}

/** ③Monthly Next Break: 今月のパワープレイ&ヘビロテ集計(/media/on-airと同じロジック)
 * から上位陣のアーティスト画像と、都道府県別プッシュ状況(日本地図用)を作る。 */
export async function fetchMonthlyPowerPlayTop(supabase: Supabase, topCount: number): Promise<PowerPlayMonthData> {
  const [y, m] = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7).split('-').map(Number)
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`
  const monthEnd = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)

  const monthRows = await fetchAllMonthRotationRows(supabase, monthStart, monthEnd)

  type RankingRow = {
    key: string
    label: string
    sub: string | null
    href: string
    artistId: string | null
    artistImageUrl: string | null
    mediaIds: Set<string>
  }
  const rankingMap = new Map<string, RankingRow>()

  type PrefectureAgg = {
    prefecture: string
    mediaIds: Set<string>
    entries: PrefectureEntry[]
    entryKeys: Set<string>
  }
  const prefMap = new Map<string, PrefectureAgg>()

  for (const row of monthRows) {
    const key = row.track_id ?? row.album_id ?? row.artist_id
    if (!key) continue
    const program = firstOf(row.media_program)
    const track = firstOf(row.track)
    const album = firstOf(row.album)
    const artist = firstOf(row.artist)
    const trackArtist = track ? firstOf(track.artist) : null
    const albumArtist = album ? firstOf(album.artist) : null
    const resolvedArtist = trackArtist ?? albumArtist ?? artist

    if (!rankingMap.has(key)) {
      rankingMap.set(key, {
        key,
        label: track?.title ?? album?.title ?? artist?.name ?? '—',
        sub: track ? (trackArtist?.name ?? null) : album ? (albumArtist?.name ?? null) : null,
        href: track ? `/tracks/${track.id}` : album ? `/albums/${album.id}` : artist ? `/artists/${artist.id}` : '',
        artistId: resolvedArtist?.id ?? null,
        artistImageUrl: resolvedArtist?.image_url ?? null,
        mediaIds: new Set(),
      })
    }
    if (program?.media_id) rankingMap.get(key)!.mediaIds.add(program.media_id)

    const media = program ? firstOf(program.media) : null
    if (media?.prefecture) {
      if (!prefMap.has(media.prefecture)) {
        prefMap.set(media.prefecture, { prefecture: media.prefecture, mediaIds: new Set(), entries: [], entryKeys: new Set() })
      }
      const agg = prefMap.get(media.prefecture)!
      if (program?.media_id) agg.mediaIds.add(program.media_id)

      const baseLabel = track?.title ?? album?.title ?? artist?.name ?? '—'
      const sub = track ? trackArtist?.name : album ? albumArtist?.name : null
      const targetHref = track ? `/tracks/${track.id}` : album ? `/albums/${album.id}` : artist ? `/artists/${artist.id}` : null
      const trackAlbum = track ? firstOf(track.album) : null
      const artworkUrl = track ? (trackAlbum?.jacket_url ?? null) : album ? null : null

      const dedupeKey = `${program?.media_id ?? ''}|${targetHref ?? baseLabel}|${row.music_type}`
      if (!agg.entryKeys.has(dedupeKey)) {
        agg.entryKeys.add(dedupeKey)
        agg.entries.push({
          stationName: media.name,
          targetLabel: sub ? `${baseLabel} — ${sub}` : baseLabel,
          targetHref,
          musicType: row.music_type as 'DOMESTIC' | 'OVERSEAS',
          artworkUrl,
        })
      }
    }
  }

  const top: PowerPlayTopEntry[] = Array.from(rankingMap.values())
    .sort((a, b) => b.mediaIds.size - a.mediaIds.size)
    .slice(0, topCount)
    .map((r) => ({
      key: r.key,
      label: r.label,
      sub: r.sub,
      href: r.href,
      artistId: r.artistId,
      artistImageUrl: r.artistImageUrl,
      mediaCount: r.mediaIds.size,
    }))

  const prefectureData: PrefectureMapData[] = Array.from(prefMap.values()).map((agg) => ({
    prefecture: agg.prefecture,
    mediaCount: agg.mediaIds.size,
    entries: agg.entries.slice().sort((a, b) => a.stationName.localeCompare(b.stationName, 'ja')),
  }))

  return { top, prefectureData }
}
