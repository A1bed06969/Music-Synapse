import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { formatDate, STREAMING_STATUS_LABEL } from '@/utils/format'

async function getLatestAlbums() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('album')
    .select('id, title, jacket_url, release_date, streaming_status, artist:artist_id(id, name)')
    .order('release_date', { ascending: false, nullsFirst: false })
    .limit(12)

  return data ?? []
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

async function getLatestRotations() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('radio_rotation')
    .select(
      `id, period_start_date, music_type,
       media_program:media_program_id(program_name, media:media_id(name)),
       track:track_id(id, title, artist:artist_id(name)),
       album:album_id(id, title, artist:artist_id(name)),
       artist:artist_id(id, name)`
    )
    .order('period_start_date', { ascending: false })
    .limit(5)

  return (data ?? []).map((row) => {
    const program = firstOf(row.media_program)
    const media = program ? firstOf(program.media) : null
    const track = firstOf(row.track)
    const album = firstOf(row.album)
    const artist = firstOf(row.artist)
    const trackArtist = track ? firstOf(track.artist) : null
    const albumArtist = album ? firstOf(album.artist) : null

    return {
      id: row.id,
      label: track?.title ?? album?.title ?? artist?.name ?? '—',
      sub: track ? (trackArtist?.name ?? null) : album ? (albumArtist?.name ?? null) : null,
      href: track ? `/tracks/${track.id}` : album ? `/albums/${album.id}` : artist ? `/artists/${artist.id}` : null,
      stationLabel: [media?.name, program?.program_name].filter(Boolean).join(' '),
      date: row.period_start_date,
    }
  })
}

const HUB_CARDS: { image: string; title: string; subtitle: string; href: string }[] = [
  { image: '/release_schedule.png', title: '新譜リリーススケジュール', subtitle: '今週・来週の新譜一覧', href: '/albums/calendar' },
  { image: '/news_stream.png', title: '最新ニュースストリーム', subtitle: '直近の更新・記事一覧', href: '/media' },
  { image: '/curation_playlist.png', title: '厳選プレイリストハブ', subtitle: 'キュレーションプレイリスト集', href: '/media/features' },
]

export default async function Home() {
  const [latestAlbums, latestRotations] = await Promise.all([getLatestAlbums(), getLatestRotations()])

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

      <section className="mt-14 text-center">
        <p className="text-2xl font-bold tracking-tight sm:text-3xl">音楽をつなぎ、新しい発見へ。</p>
      </section>

      <section className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
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

      <section className="mt-14">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">パワープレイ&ヘビロテ</h2>
          <Link href="/media/on-air" className="text-xs text-white/40 hover:text-white/70">
            すべて表示 →
          </Link>
        </div>

        {latestRotations.length === 0 ? (
          <p className="mt-6 text-sm text-white/40">まだオンエアデータが登録されていません。</p>
        ) : (
          <ul className="mt-6 divide-y divide-white/10">
            {latestRotations.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  {r.href ? (
                    <Link href={r.href} className="font-medium hover:opacity-70">
                      {r.label}
                    </Link>
                  ) : (
                    <span className="font-medium">{r.label}</span>
                  )}
                  {r.sub && <p className="text-xs text-white/40">{r.sub}</p>}
                </div>
                <div className="shrink-0 text-right text-xs text-white/40">
                  <p>{r.stationLabel}</p>
                  <p>{formatDate(r.date)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
