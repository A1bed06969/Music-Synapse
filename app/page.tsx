import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { formatDate, STREAMING_STATUS_LABEL } from '@/utils/format'

async function getStats() {
  const supabase = await createClient()

  const [artist, album, track, event, discGuide] = await Promise.all([
    supabase.from('artist').select('*', { count: 'exact', head: true }),
    supabase.from('album').select('*', { count: 'exact', head: true }),
    supabase.from('track').select('*', { count: 'exact', head: true }),
    supabase.from('event').select('*', { count: 'exact', head: true }),
    supabase.from('disc_guide').select('*', { count: 'exact', head: true }),
  ])

  return {
    artist: artist.count ?? 0,
    album: album.count ?? 0,
    track: track.count ?? 0,
    event: event.count ?? 0,
    discGuide: discGuide.count ?? 0,
  }
}

async function getLatestAlbums() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('album')
    .select('id, title, jacket_url, release_date, streaming_status, artist:artist_id(id, name)')
    .order('release_date', { ascending: false, nullsFirst: false })
    .limit(8)

  return data ?? []
}

const STAT_ITEMS: { key: 'artist' | 'album' | 'track' | 'event' | 'discGuide'; label: string; href?: string }[] = [
  { key: 'artist', label: 'アーティスト', href: '/artists' },
  { key: 'album', label: 'アルバム', href: '/albums' },
  { key: 'track', label: 'トラック' },
  { key: 'event', label: 'イベント', href: '/events' },
  { key: 'discGuide', label: 'ディスクガイド' },
]

export default async function Home() {
  const [stats, latestAlbums] = await Promise.all([getStats(), getLatestAlbums()])

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <section className="text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">🧠 Music Synapse</h1>
        <p className="mt-2 text-sm text-white/50">
          世界中の音楽データ・メディア・文脈をシナプスのように結合する
        </p>

        <form action="/search" className="mx-auto mt-8 flex max-w-xl gap-2">
          <input
            type="text"
            name="q"
            placeholder="アーティスト・アルバム・トラックを検索..."
            className="flex-1 rounded-md border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-md bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-white/85"
          >
            検索
          </button>
        </form>
      </section>

      <section className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {STAT_ITEMS.map((item) => {
          const tileClass = 'rounded-lg border border-white/10 bg-white/[0.03] px-4 py-5 text-center'
          const tileContent = (
            <>
              <p className="text-2xl font-bold">{stats[item.key].toLocaleString()}</p>
              <p className="mt-1 text-xs text-white/50">{item.label}</p>
            </>
          )
          return item.href ? (
            <Link key={item.key} href={item.href} className={`${tileClass} transition hover:border-white/25`}>
              {tileContent}
            </Link>
          ) : (
            <div key={item.key} className={tileClass}>
              {tileContent}
            </div>
          )
        })}
      </section>

      <section className="mt-14">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">新着アルバム</h2>
          <Link href="/search" className="text-xs text-white/40 hover:text-white/70">
            すべて見る →
          </Link>
        </div>

        {latestAlbums.length === 0 ? (
          <p className="mt-6 text-sm text-white/40">まだアルバムが登録されていません。</p>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {latestAlbums.map((album) => {
              const artist = Array.isArray(album.artist) ? album.artist[0] : album.artist
              const status = album.streaming_status ? STREAMING_STATUS_LABEL[album.streaming_status] : null

              return (
                <Link
                  key={album.id}
                  href={`/albums/${album.id}`}
                  className="group block"
                >
                  <div className="aspect-square overflow-hidden rounded-md bg-white/5">
                    {album.jacket_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={album.jacket_url}
                        alt={album.title}
                        className="h-full w-full object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-white/20">
                        No Art
                      </div>
                    )}
                  </div>
                  <p className="mt-2 truncate text-sm font-medium">{album.title}</p>
                  <p className="truncate text-xs text-white/50">{artist?.name}</p>
                  <p className="mt-0.5 text-xs text-white/30">
                    {formatDate(album.release_date)}
                    {status ? ` · ${status.icon}` : ''}
                  </p>
                </Link>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
