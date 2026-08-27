import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import CalendarView, { type CalendarAlbum } from './CalendarView'

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

  const { data: pickupRows } = await supabase
    .from('album_pickup')
    .select('id, blurb, album:album_id(id, title, jacket_url, artist:artist_id(name))')
    .order('sort_order', { ascending: true })

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

      {pickupRows && pickupRows.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-white/50">今週の新譜ピックアップ</h2>
          <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
            {pickupRows.map((p) => {
              const album = Array.isArray(p.album) ? p.album[0] : p.album
              const artist = album ? (Array.isArray(album.artist) ? album.artist[0] : album.artist) : null
              if (!album) return null
              return (
                <Link key={p.id} href={`/albums/${album.id}`} className="group block w-40 shrink-0">
                  <div className="aspect-square overflow-hidden rounded-md bg-white/5">
                    {album.jacket_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={album.jacket_url}
                        alt={album.title}
                        className="h-full w-full object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-white/20">No Art</div>
                    )}
                  </div>
                  <p className="mt-2 truncate text-sm font-medium group-hover:opacity-70">{album.title}</p>
                  <p className="truncate text-xs text-white/50">{artist?.name}</p>
                  {p.blurb && <p className="mt-1 line-clamp-3 text-xs text-white/40">{p.blurb}</p>}
                </Link>
              )
            })}
          </div>
        </section>
      )}

      <CalendarView
        month={currentMonth}
        monthLabel={monthLabel(currentMonth)}
        prevMonthHref={`/albums/calendar?month=${shiftMonth(currentMonth, -1)}`}
        nextMonthHref={`/albums/calendar?month=${shiftMonth(currentMonth, 1)}`}
        albums={albums}
      />
    </div>
  )
}
