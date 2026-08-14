import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { formatDate, formatDuration, STREAMING_STATUS_LABEL } from '@/utils/format'
import PreviewButton from '@/app/components/PreviewButton'

export default async function AlbumDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: album, error } = await supabase
    .from('album')
    .select('*, artist:artist_id(id, name), label:label_id(id, name)')
    .eq('id', id)
    .single()

  if (error || !album) {
    notFound()
  }

  const [{ data: tracks }, { data: discGuideSelections }] = await Promise.all([
    supabase
      .from('track')
      .select('id, track_no, title, duration_seconds, preview_url')
      .eq('album_id', id)
      .order('track_no', { ascending: true }),
    supabase
      .from('disc_guide_selection')
      .select('id, note, disc_guide:disc_guide_id(id, title, publisher, published_year)')
      .eq('album_id', id),
  ])

  const artist = Array.isArray(album.artist) ? album.artist[0] : album.artist
  const label = Array.isArray(album.label) ? album.label[0] : album.label
  const status = album.streaming_status ? STREAMING_STATUS_LABEL[album.streaming_status] : null

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      {artist && (
        <Link href={`/artists/${artist.id}`} className="text-xs text-white/40 hover:text-white/70">
          ← {artist.name}
        </Link>
      )}

      <div className="mt-4 flex flex-col gap-6 sm:flex-row">
        <div className="w-full max-w-xs shrink-0 overflow-hidden rounded-md bg-white/5 sm:w-56">
          {album.jacket_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={album.jacket_url} alt={album.title} className="aspect-square w-full object-cover" />
          ) : (
            <div className="flex aspect-square w-full items-center justify-center text-white/20">
              No Art
            </div>
          )}
        </div>

        <div>
          <h1 className="text-2xl font-bold">{album.title}</h1>
          {artist && (
            <Link href={`/artists/${artist.id}`} className="mt-1 block text-sm text-white/60 hover:text-white">
              {artist.name}
            </Link>
          )}

          <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/60">
            {album.album_type && (
              <span className="rounded-full border border-white/15 px-2.5 py-0.5">{album.album_type}</span>
            )}
            {album.format && (
              <span className="rounded-full border border-white/15 px-2.5 py-0.5">{album.format}</span>
            )}
            {status && (
              <span className="rounded-full border border-white/15 px-2.5 py-0.5">
                {status.icon} {status.label}
              </span>
            )}
          </div>

          <div className="mt-4 space-y-1 text-sm text-white/50">
            <p>発売日: {formatDate(album.release_date)}</p>
            {label && (
              <p>
                レーベル:{' '}
                <Link href={`/labels/${label.id}`} className="hover:text-white">
                  {label.name}
                </Link>
              </p>
            )}
            {album.track_count && <p>収録曲数: {album.track_count}曲</p>}
          </div>

          {album.jan_code && (
            <div className="mt-4 flex gap-3 text-xs">
              <a
                href={`https://www.discogs.com/search/?q=${album.jan_code}&type=release`}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-white/15 px-3 py-1 text-white/60 hover:text-white"
              >
                Discogsで探す
              </a>
              <a
                href={`https://www.amazon.co.jp/s?k=${album.jan_code}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-white/15 px-3 py-1 text-white/60 hover:text-white"
              >
                Amazonで探す
              </a>
            </div>
          )}
        </div>
      </div>

      {album.album_review && (
        <p className="mt-8 text-sm leading-relaxed text-white/70">{album.album_review}</p>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">トラックリスト</h2>
        {!tracks || tracks.length === 0 ? (
          <p className="mt-4 text-sm text-white/40">まだトラックが登録されていません。</p>
        ) : (
          <ol className="mt-4 divide-y divide-white/10">
            {tracks.map((track) => (
              <li key={track.id} className="flex items-center gap-3 py-3 text-sm">
                <Link
                  href={`/tracks/${track.id}`}
                  className="flex flex-1 items-center gap-4 transition hover:opacity-70"
                >
                  <span className="w-5 shrink-0 text-right text-white/30">{track.track_no ?? '-'}</span>
                  <span className="flex-1">{track.title}</span>
                  <span className="text-white/30">{formatDuration(track.duration_seconds)}</span>
                </Link>
                <PreviewButton previewUrl={track.preview_url} trackId={track.id} size="sm" />
              </li>
            ))}
          </ol>
        )}
      </section>

      {discGuideSelections && discGuideSelections.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">掲載ディスクガイド</h2>
          <ul className="mt-4 space-y-1 text-sm text-white/60">
            {discGuideSelections.map((row) => {
              const guide = Array.isArray(row.disc_guide) ? row.disc_guide[0] : row.disc_guide
              if (!guide) return null
              const meta = [guide.publisher, guide.published_year ? `${guide.published_year}年` : null]
                .filter(Boolean)
                .join(' / ')
              return (
                <li key={row.id}>
                  {guide.title}
                  {meta && <span className="text-white/40"> ({meta})</span>}
                  {row.note && <span className="text-white/40"> ・ {row.note}</span>}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
