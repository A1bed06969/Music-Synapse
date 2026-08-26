import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../../../../adminUi'
import SearchableSelect from '../../../../SearchableSelect'
import { searchTracks, searchAlbums, searchArtists } from '../../../../actions'
import { updateRadioRotation, deleteRadioRotation } from '../../../actions'

const PERIOD_TYPE_OPTIONS = [
  { value: 'weekly', label: '週間' },
  { value: 'monthly', label: '月間' },
]

const MUSIC_TYPE_OPTIONS = [
  { value: 'DOMESTIC', label: '邦楽' },
  { value: 'OVERSEAS', label: '洋楽' },
]

export default async function EditRadioRotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: entry, error }, { data: mediaPrograms }] = await Promise.all([
    supabase
      .from('radio_rotation')
      .select(
        'id, media_program_id, period_type, period_start_date, music_type, note, track_id, album_id, artist_id, track:track_id(title, artist:artist_id(name), album:album_id(title)), album:album_id(title, artist:artist_id(name)), artist:artist_id(name)'
      )
      .eq('id', id)
      .single(),
    supabase.from('media_program').select('id, program_name, media:media_id(name)').order('program_name'),
  ])

  if (error || !entry) {
    notFound()
  }

  const track = Array.isArray(entry.track) ? entry.track[0] : entry.track
  const trackArtist = track ? (Array.isArray(track.artist) ? track.artist[0] : track.artist) : null
  const trackAlbum = track ? (Array.isArray(track.album) ? track.album[0] : track.album) : null
  const trackLabel = track
    ? `${track.title}${trackArtist?.name ? ` — ${trackArtist.name}` : ''}${trackAlbum?.title ? `(${trackAlbum.title})` : ''}`
    : null

  const album = Array.isArray(entry.album) ? entry.album[0] : entry.album
  const albumArtist = album ? (Array.isArray(album.artist) ? album.artist[0] : album.artist) : null
  const albumLabel = album ? `${album.title}${albumArtist?.name ? ` — ${albumArtist.name}` : ''}` : null

  const directArtist = Array.isArray(entry.artist) ? entry.artist[0] : entry.artist

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data/media" className="text-xs text-white/40 hover:text-white/70">
        ← メディア&オンエアに戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">オンエアデータを編集</h1>

      <form action={updateRadioRotation} className="mt-6 space-y-2">
        <input type="hidden" name="id" value={entry.id} />
        <input type="hidden" name="previous_track_id" value={entry.track_id ?? ''} />
        <div className="flex flex-wrap gap-2">
          <select
            name="media_program_id"
            required
            className={`${inputClass} max-w-xs`}
            defaultValue={entry.media_program_id}
          >
            {(mediaPrograms ?? []).map((p) => {
              const media = Array.isArray(p.media) ? p.media[0] : p.media
              return (
                <option key={p.id} value={p.id}>
                  {media?.name} — {p.program_name}
                </option>
              )
            })}
          </select>
          <select name="period_type" required className={`${inputClass} max-w-[120px]`} defaultValue={entry.period_type}>
            {PERIOD_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input
            name="period_start_date"
            type="date"
            required
            defaultValue={entry.period_start_date}
            className={`${inputClass} max-w-[160px]`}
          />
          <select name="music_type" required className={`${inputClass} max-w-[120px]`} defaultValue={entry.music_type}>
            {MUSIC_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-white/40">対象は「トラック」「アルバム」「アーティスト」のうちどれか1つだけ選んでください。</p>
        <div className="flex flex-wrap gap-2">
          <SearchableSelect
            searchAction={searchTracks}
            name="track_id"
            placeholder="トラックを検索(任意)"
            defaultSelected={trackLabel ? [{ id: entry.track_id!, label: trackLabel }] : []}
          />
          <SearchableSelect
            searchAction={searchAlbums}
            name="album_id"
            placeholder="アルバムを検索(任意)"
            defaultSelected={albumLabel ? [{ id: entry.album_id!, label: albumLabel }] : []}
          />
          <SearchableSelect
            searchAction={searchArtists}
            name="artist_id"
            placeholder="アーティストを検索(任意)"
            defaultSelected={directArtist?.name && entry.artist_id ? [{ id: entry.artist_id, label: directArtist.name }] : []}
          />
        </div>
        <input name="note" placeholder="メモ(任意)" defaultValue={entry.note ?? ''} className={inputClass} />
        <button type="submit" className={buttonClass}>
          更新する
        </button>
      </form>

      <form action={deleteRadioRotation} className="mt-6">
        <input type="hidden" name="id" value={entry.id} />
        <input type="hidden" name="track_id" value={entry.track_id ?? ''} />
        <button
          type="submit"
          className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
        >
          このオンエアデータを削除
        </button>
      </form>
    </div>
  )
}
