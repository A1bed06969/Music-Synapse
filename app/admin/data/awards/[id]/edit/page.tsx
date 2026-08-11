import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../../../adminUi'
import SearchableSelect from '../../../SearchableSelect'
import { searchTracks, searchAlbums } from '../../../actions'
import { updateAwardEntry, deleteAwardEntry } from '../../actions'

const AWARD_RESULT_OPTIONS = [
  { value: 'nominee', label: 'ノミネート' },
  { value: 'winner', label: '受賞' },
]

export default async function EditAwardEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: entry, error }, { data: awards }, { data: artists }] = await Promise.all([
    supabase
      .from('award_entry')
      .select(
        'id, award_id, year, category, result, track_id, album_id, artist_id, track:track_id(title, artist:artist_id(name), album:album_id(title)), album:album_id(title, artist:artist_id(name))'
      )
      .eq('id', id)
      .single(),
    supabase.from('award').select('id, name').order('name'),
    supabase.from('artist').select('id, name').order('name'),
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

  const artistOptions = artists ?? []

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/admin/data/awards" className="text-xs text-white/40 hover:text-white/70">
        ← アワード一覧に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">受賞・ノミネートを編集</h1>

      <form action={updateAwardEntry} className="mt-6 space-y-2">
        <input type="hidden" name="id" value={entry.id} />
        <input type="hidden" name="previous_artist_id" value={entry.artist_id ?? ''} />
        <input type="hidden" name="previous_track_id" value={entry.track_id ?? ''} />
        <div className="flex flex-wrap gap-2">
          <select name="award_id" required className={`${inputClass} max-w-xs`} defaultValue={entry.award_id}>
            {(awards ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <input name="year" type="number" defaultValue={entry.year} required className={`${inputClass} max-w-[100px]`} />
          <input name="category" placeholder="部門(任意)" defaultValue={entry.category ?? ''} className={`${inputClass} max-w-xs`} />
          <select name="result" required className={`${inputClass} max-w-[140px]`} defaultValue={entry.result}>
            {AWARD_RESULT_OPTIONS.map((opt) => (
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
          <select name="artist_id" className={`${inputClass} max-w-xs`} defaultValue={entry.artist_id ?? ''}>
            <option value="">(アーティスト指定なし)</option>
            {artistOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonClass}>
          更新する
        </button>
      </form>

      <form action={deleteAwardEntry} className="mt-6">
        <input type="hidden" name="id" value={entry.id} />
        <input type="hidden" name="artist_id" value={entry.artist_id ?? ''} />
        <input type="hidden" name="track_id" value={entry.track_id ?? ''} />
        <button
          type="submit"
          className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
        >
          この受賞・ノミネートを削除
        </button>
      </form>
    </div>
  )
}
