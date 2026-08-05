import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { notFound } from 'next/navigation'
import { formatDate, ARTIST_STREAMING_STATUS_LABEL, ARTIST_TYPE_LABEL } from '@/utils/format'

export default async function ArtistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: artist, error }, { data: albums }] = await Promise.all([
    supabase.from('artist').select('*').eq('id', id).single(),
    supabase
      .from('album')
      .select('id, title, jacket_url, release_date, album_type')
      .eq('artist_id', id)
      .order('release_date', { ascending: false, nullsFirst: false }),
  ])

  if (error || !artist) {
    notFound()
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/search" className="text-xs text-white/40 hover:text-white/70">
        ← 検索に戻る
      </Link>

      <div className="mt-4 flex items-start gap-6">
        {artist.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artist.image_url}
            alt={artist.name}
            className="h-28 w-28 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full bg-white/5 text-3xl">
            🎤
          </div>
        )}

        <div>
          <h1 className="text-2xl font-bold">{artist.name}</h1>
          <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-white/50">
            {artist.name_kana && <span>{artist.name_kana}</span>}
            {artist.name_en && <span>{artist.name_en}</span>}
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/60">
            {artist.artist_type && (
              <span className="rounded-full border border-white/15 px-2.5 py-0.5">
                {ARTIST_TYPE_LABEL[artist.artist_type as keyof typeof ARTIST_TYPE_LABEL] ?? artist.artist_type}
              </span>
            )}
            {artist.formed_year && (
              <span className="rounded-full border border-white/15 px-2.5 py-0.5">
                結成 {artist.formed_year}年
              </span>
            )}
            {(artist.origin_prefecture || artist.hometown_city) && (
              <span className="rounded-full border border-white/15 px-2.5 py-0.5">
                {artist.hometown_city ?? artist.origin_prefecture}
              </span>
            )}
            {artist.streaming_status && (
              <span className="rounded-full border border-white/15 px-2.5 py-0.5">
                配信: {ARTIST_STREAMING_STATUS_LABEL[artist.streaming_status]}
              </span>
            )}
          </div>

          <div className="mt-3 flex gap-3 text-xs text-white/40">
            {artist.official_site_url && (
              <a href={artist.official_site_url} target="_blank" rel="noreferrer" className="hover:text-white/70">
                公式サイト
              </a>
            )}
            {artist.sns_x_url && (
              <a href={artist.sns_x_url} target="_blank" rel="noreferrer" className="hover:text-white/70">
                X
              </a>
            )}
            {artist.sns_instagram_url && (
              <a href={artist.sns_instagram_url} target="_blank" rel="noreferrer" className="hover:text-white/70">
                Instagram
              </a>
            )}
            <Link href={`/artists/${artist.id}/relations`} className="hover:text-white/70">
              🔗 相関図を見る
            </Link>
          </div>
        </div>
      </div>

      {artist.bio && <p className="mt-8 text-sm leading-relaxed text-white/70">{artist.bio}</p>}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">アルバム</h2>
        {!albums || albums.length === 0 ? (
          <p className="mt-4 text-sm text-white/40">まだアルバムが登録されていません。</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {albums.map((album) => (
              <Link key={album.id} href={`/albums/${album.id}`} className="group block">
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
                <p className="text-xs text-white/40">{formatDate(album.release_date)}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
