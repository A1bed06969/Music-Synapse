import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { formatDuration } from '@/utils/format'

export default async function TrackDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: track, error } = await supabase
    .from('track')
    .select('*, album:album_id(id, title, jacket_url), artist:artist_id(id, name)')
    .eq('id', id)
    .single()

  if (error || !track) {
    notFound()
  }

  const [{ data: credits }, { data: trackInstruments }] = await Promise.all([
    supabase.from('track_credit').select('role, person_name').eq('track_id', id),
    supabase.from('track_instrument').select('instrument:instrument_id(id, name)').eq('track_id', id),
  ])

  const album = Array.isArray(track.album) ? track.album[0] : track.album
  const artist = Array.isArray(track.artist) ? track.artist[0] : track.artist

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      {album && (
        <Link href={`/albums/${album.id}`} className="text-xs text-white/40 hover:text-white/70">
          ← {album.title}
        </Link>
      )}

      <div className="mt-4 flex items-start gap-5">
        {album?.jacket_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={album.jacket_url} alt={album.title} className="h-24 w-24 shrink-0 rounded-md object-cover" />
        ) : (
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-md bg-white/5 text-white/20">
            No Art
          </div>
        )}

        <div>
          <h1 className="text-2xl font-bold">{track.title}</h1>
          {artist && (
            <Link href={`/artists/${artist.id}`} className="mt-1 block text-sm text-white/60 hover:text-white">
              {artist.name}
            </Link>
          )}
          <p className="mt-2 text-sm text-white/40">{formatDuration(track.duration_seconds)}</p>
        </div>
      </div>

      {track.lyric_url && (
        <a
          href={track.lyric_url}
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-block rounded-full border border-white/15 px-3 py-1 text-xs text-white/60 hover:text-white"
        >
          歌詞を見る
        </a>
      )}

      {trackInstruments && trackInstruments.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-medium uppercase tracking-wide text-white/40">使用楽器</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {trackInstruments.map((row, i) => {
              const instrument = Array.isArray(row.instrument) ? row.instrument[0] : row.instrument
              if (!instrument) return null
              return (
                <Link
                  key={i}
                  href={`/tracks/instrument/${instrument.id}`}
                  className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/60 hover:text-white"
                >
                  🎸 {instrument.name}
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {credits && credits.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-medium uppercase tracking-wide text-white/40">クレジット</h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            {credits.map((credit, i) => (
              <li key={i} className="flex justify-between text-white/70">
                <span>{credit.person_name}</span>
                <span className="text-white/40">{credit.role}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {track.track_review && (
        <p className="mt-8 text-sm leading-relaxed text-white/70">{track.track_review}</p>
      )}
    </div>
  )
}
