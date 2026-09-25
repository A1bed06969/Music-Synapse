import { createClient } from '@/utils/Supabase/server'
import { tomorrowJST } from '@/utils/homeCards'
import { type CalendarAlbum } from './CalendarView'
import { type RecentReleaseAlbum } from './RecentReleasesCarousel'
import CalendarPageClient from './CalendarPageClient'

function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const nextMonthDate = new Date(Date.UTC(y, m, 1))
  const end = nextMonthDate.toISOString().slice(0, 10)
  return { start, end }
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

  // 「今週の新譜ピックアップ」: 明日以降にリリースされる新譜(ホームのDiscover New
  // Musicと同じ定義)をカルーセルで表示し、フォーカス中のアルバムだけ収録曲・
  // 紹介文まで取得する(全件分のトラックリストを毎回引く必要は無いため、月表示
  // 用のalbumsクエリとは別に絞り込んで取得する)
  const tomorrow = tomorrowJST()
  const { data: recentReleaseRows } = await supabase
    .from('album')
    .select('id, title, jacket_url, release_date, album_review, artist:artist_id(id, name, image_url)')
    .gte('release_date', tomorrow)
    .is('primary_album_id', null)
    .order('release_date', { ascending: true })
    .limit(20)

  const recentReleaseAlbumIds = (recentReleaseRows ?? []).map((a) => a.id)
  const { data: recentReleaseTrackRows } = recentReleaseAlbumIds.length
    ? await supabase
        .from('track')
        .select('id, album_id, track_no, disc_number, title')
        .in('album_id', recentReleaseAlbumIds)
        .order('disc_number', { ascending: true, nullsFirst: true })
        .order('track_no', { ascending: true })
    : { data: [] }

  const tracksByAlbum = new Map<string, RecentReleaseAlbum['tracks']>()
  for (const t of recentReleaseTrackRows ?? []) {
    const list = tracksByAlbum.get(t.album_id) ?? []
    list.push({ id: t.id, trackNo: t.track_no, title: t.title })
    tracksByAlbum.set(t.album_id, list)
  }

  const recentReleases: RecentReleaseAlbum[] = (recentReleaseRows ?? [])
    .filter((a) => !!a.release_date)
    .map((a) => {
      const artist = Array.isArray(a.artist) ? a.artist[0] : a.artist
      return {
        id: a.id,
        title: a.title,
        jacketUrl: a.jacket_url,
        releaseDate: a.release_date as string,
        artistId: artist?.id ?? null,
        artistName: artist?.name ?? '不明',
        artistImageUrl: artist?.image_url ?? null,
        review: a.album_review,
        tracks: tracksByAlbum.get(a.id) ?? [],
      }
    })

  return (
    <CalendarPageClient
      month={currentMonth}
      monthLabel={monthLabel(currentMonth)}
      prevMonthHref={`/albums/calendar?month=${shiftMonth(currentMonth, -1)}`}
      nextMonthHref={`/albums/calendar?month=${shiftMonth(currentMonth, 1)}`}
      albums={albums}
      recentReleases={recentReleases}
    />
  )
}
