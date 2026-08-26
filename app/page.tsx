import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { formatDate, STREAMING_STATUS_LABEL } from '@/utils/format'
import CatalogSearchBox from '@/app/components/CatalogSearchBox'

async function getLatestAlbums() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('album')
    .select('id, title, jacket_url, release_date, streaming_status, artist:artist_id(id, name)')
    .is('primary_album_id', null)
    .order('release_date', { ascending: false, nullsFirst: false })
    .limit(12)

  return data ?? []
}

const HUB_CARDS: { image: string; title: string; subtitle: string; href: string }[] = [
  { image: '/release_schedule.png', title: '新譜リリーススケジュール', subtitle: '今週・来週の新譜一覧', href: '/albums/calendar' },
  { image: '/news_stream.png', title: '最新ニュースストリーム', subtitle: '直近の更新・記事一覧', href: '/media/news' },
  { image: '/curation_playlist.png', title: '厳選プレイリストハブ', subtitle: 'キュレーションプレイリスト集', href: '/media/playlists' },
]

export default async function Home() {
  const latestAlbums = await getLatestAlbums()

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <section className="text-center">
        <h1>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-full.png"
            alt="Music Synapse"
            className="mx-auto h-24 w-auto object-contain sm:h-32"
          />
        </h1>
        <p className="mt-2 text-sm text-white/50">音楽をつなぎ、新しい発見へ。</p>

        <div className="mx-auto mt-8 max-w-xl">
          <CatalogSearchBox variant="overlay" />
        </div>
      </section>

      <section className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {HUB_CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group relative block aspect-[4/3] overflow-hidden rounded-lg border border-white/10 transition hover:border-white/25"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.image}
              alt={card.title}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-105 group-hover:opacity-80"
            />
          </Link>
        ))}
      </section>

      <section className="mt-14">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">新着アルバム</h2>
          <div className="flex items-center gap-4">
            <Link href="/albums/calendar" className="text-xs text-white/40 hover:text-white/70">
              🗓️ カレンダーで見る
            </Link>
            <Link href="/albums?sort=release" className="text-xs text-white/40 hover:text-white/70">
              発売日順ですべて見る →
            </Link>
          </div>
        </div>

        {latestAlbums.length === 0 ? (
          <p className="mt-6 text-sm text-white/40">まだアルバムが登録されていません。</p>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-6">
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
