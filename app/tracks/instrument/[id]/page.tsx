import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { formatDuration } from '@/utils/format'

export default async function InstrumentTracksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: instrument, error } = await supabase.from('instrument').select('id, name').eq('id', id).single()

  if (error || !instrument) {
    notFound()
  }

  const { data: trackInstruments } = await supabase
    .from('track_instrument')
    .select('track:track_id(id, title, duration_seconds, artist:artist_id(id, name))')
    .eq('instrument_id', id)

  const tracks = (trackInstruments ?? [])
    .map((row) => (Array.isArray(row.track) ? row.track[0] : row.track))
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
    .sort((a, b) => a.title.localeCompare(b.title, 'ja'))

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/tracks" className="text-xs text-white/40 hover:text-white/70">
        ← トラック一覧に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">🎸 {instrument.name}</h1>
      <p className="mt-2 text-sm text-white/50">この楽器が使われているトラック{tracks.length}曲</p>

      {tracks.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">まだ登録されているトラックがありません。</p>
      ) : (
        <ul className="mt-8 divide-y divide-white/10">
          {tracks.map((track) => {
            const artist = Array.isArray(track.artist) ? track.artist[0] : track.artist
            return (
              <li key={track.id}>
                <Link
                  href={`/tracks/${track.id}`}
                  className="flex items-center justify-between gap-3 py-3 text-sm transition hover:opacity-70"
                >
                  <span>
                    {track.title}
                    {artist && <span className="text-white/40"> — {artist.name}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-white/30">{formatDuration(track.duration_seconds)}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
