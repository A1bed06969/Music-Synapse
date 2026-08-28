import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { updateTrack } from '@/app/admin/data/actions'

const inputClass =
  'w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none'
const buttonClass =
  'rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85'

export default async function TrackEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: track, error } = await supabase
    .from('track')
    .select('*, artist:artist_id(name)')
    .eq('id', id)
    .single()

  if (error || !track) {
    notFound()
  }

  const artist = Array.isArray(track.artist) ? track.artist[0] : track.artist

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href={`/tracks/${id}`} className="text-xs text-white/40 hover:text-white/70">
        ← トラックに戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{track.title} を編集</h1>
      {artist && <p className="mt-1 text-sm text-white/50">{artist.name}</p>}
      <Link href={`/admin/data/tracks/${id}/co-artists`} className="mt-2 inline-block text-xs text-white/40 hover:text-white/70">
        追加アーティストを紐付け →
      </Link>

      <form action={updateTrack} className="mt-8 space-y-4">
        <input type="hidden" name="track_id" value={track.id} />

        <div className="flex flex-wrap gap-2">
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">Spotify Track ID</label>
            <input name="spotify_track_id" defaultValue={track.spotify_track_id ?? ''} className={inputClass} />
          </div>
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">YouTube Video ID</label>
            <input name="youtube_video_id" defaultValue={track.youtube_video_id ?? ''} className={inputClass} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">Amazon Music Track ID</label>
            <input
              name="amazon_music_track_id"
              defaultValue={track.amazon_music_track_id ?? ''}
              className={inputClass}
            />
          </div>
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">YouTube Music Track ID</label>
            <input
              name="youtube_music_track_id"
              defaultValue={track.youtube_music_track_id ?? ''}
              className={inputClass}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">Bandcamp Track ID</label>
            <input name="bandcamp_track_id" defaultValue={track.bandcamp_track_id ?? ''} className={inputClass} />
          </div>
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">SoundCloud Track ID</label>
            <input name="soundcloud_track_id" defaultValue={track.soundcloud_track_id ?? ''} className={inputClass} />
          </div>
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">Tidal Track ID</label>
            <input name="tidal_track_id" defaultValue={track.tidal_track_id ?? ''} className={inputClass} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-white/40">歌詞URL</label>
          <input name="lyric_url" type="url" defaultValue={track.lyric_url ?? ''} className={inputClass} />
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="max-w-xs flex-1">
            <label className="mb-1 block text-xs text-white/40">ISRC</label>
            <input name="isrc" defaultValue={track.isrc ?? ''} className={inputClass} />
          </div>
          <div className="max-w-[140px] flex-1">
            <label className="mb-1 block text-xs text-white/40">BPM</label>
            <input name="bpm" type="number" step="0.1" defaultValue={track.bpm ?? ''} className={inputClass} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-white/40">レビュー</label>
          <textarea name="track_review" rows={4} defaultValue={track.track_review ?? ''} className={inputClass} />
        </div>

        <button type="submit" className={buttonClass}>
          保存
        </button>
      </form>
    </div>
  )
}
