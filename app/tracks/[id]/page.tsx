import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { formatDuration, extractYoutubeVideoId } from '@/utils/format'

const WORK_TYPE_LABEL: Record<string, string> = {
  cm: 'CM',
  anime: 'アニメ',
  game: 'ゲーム',
  movie: '映画',
  tv_program: 'テレビ番組',
}

export default async function TrackDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { id } = await params
  const { success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  const { data: track, error } = await supabase
    .from('track')
    .select('*, album:album_id(id, title, jacket_url, apple_music_album_id), artist:artist_id(id, name)')
    .eq('id', id)
    .single()

  if (error || !track) {
    notFound()
  }

  const [{ data: credits }, { data: trackInstruments }, { data: syncEntries }, { data: rotations }] =
    await Promise.all([
      supabase.from('track_credit').select('role, person_name').eq('track_id', id),
      supabase.from('track_instrument').select('instrument:instrument_id(id, name)').eq('track_id', id),
      supabase
        .from('sync_entry')
        .select('id, usage_detail, sync_work:sync_work_id(id, title, work_type, year)')
        .eq('track_id', id),
      supabase
        .from('radio_rotation')
        .select(
          'id, period_start_date, music_type, media_program:media_program_id(program_name, media:media_id(name))'
        )
        .eq('track_id', id)
        .order('period_start_date', { ascending: false }),
    ])

  const album = Array.isArray(track.album) ? track.album[0] : track.album
  const artist = Array.isArray(track.artist) ? track.artist[0] : track.artist

  const appleMusicSrc =
    track.apple_music_track_id && album?.apple_music_album_id
      ? `https://embed.music.apple.com/jp/album/${encodeURIComponent(track.title)}/${album.apple_music_album_id}?i=${track.apple_music_track_id}`
      : null

  const youtubeVideoId = track.youtube_video_id ? extractYoutubeVideoId(track.youtube_video_id) : null
  const youtubeSrc = youtubeVideoId ? `https://www.youtube.com/embed/${youtubeVideoId}` : null
  const hasPlayer = Boolean(youtubeSrc || appleMusicSrc || track.spotify_track_id)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      {success && (
        <div className="mb-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      <div className="flex items-center justify-between">
        {album ? (
          <Link href={`/albums/${album.id}`} className="text-xs text-white/40 hover:text-white/70">
            ← {album.title}
          </Link>
        ) : (
          <span />
        )}
        <Link href={`/admin/data/tracks/${id}/edit`} className="text-xs text-white/40 hover:text-white/70">
          編集
        </Link>
      </div>

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

      {(track.track_review || hasPlayer) && (
        <div
          className={
            track.track_review && hasPlayer ? 'mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2' : 'mt-6'
          }
        >
          {track.track_review && <p className="text-sm leading-relaxed text-white/70">{track.track_review}</p>}
          {hasPlayer && (
            <div className="space-y-3">
              {youtubeSrc && (
                <div className="aspect-video overflow-hidden rounded-md bg-black">
                  <iframe
                    src={youtubeSrc}
                    title={track.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    loading="lazy"
                    className="h-full w-full"
                  />
                </div>
              )}
              {appleMusicSrc && (
                <iframe
                  allow="autoplay *; encrypted-media *; clipboard-write"
                  frameBorder="0"
                  height="175"
                  style={{ width: '100%', maxWidth: '660px', overflow: 'hidden', borderRadius: '10px' }}
                  sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"
                  src={appleMusicSrc}
                  loading="lazy"
                />
              )}
              {track.spotify_track_id && (
                <iframe
                  style={{ borderRadius: '12px' }}
                  src={`https://open.spotify.com/embed/track/${track.spotify_track_id}?utm_source=generator`}
                  width="100%"
                  height="152"
                  frameBorder="0"
                  allowFullScreen
                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  loading="lazy"
                />
              )}
            </div>
          )}
        </div>
      )}

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

      {syncEntries && syncEntries.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-medium uppercase tracking-wide text-white/40">タイアップ実績</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-white/70">
            {syncEntries.map((row) => {
              const work = Array.isArray(row.sync_work) ? row.sync_work[0] : row.sync_work
              if (!work) return null
              return (
                <li key={row.id}>
                  {work.title}
                  {work.work_type && (
                    <span className="text-white/40"> ({WORK_TYPE_LABEL[work.work_type] ?? work.work_type})</span>
                  )}
                  {row.usage_detail && <span className="text-white/40"> ・ {row.usage_detail}</span>}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {rotations && rotations.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-medium uppercase tracking-wide text-white/40">パワープレイ/ヘビロテ実績</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-white/70">
            {rotations.map((row) => {
              const program = Array.isArray(row.media_program) ? row.media_program[0] : row.media_program
              const media = program ? (Array.isArray(program.media) ? program.media[0] : program.media) : null
              return (
                <li key={row.id}>
                  {media?.name} {program?.program_name}
                  <span className="text-white/40"> ・ {row.period_start_date}</span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
