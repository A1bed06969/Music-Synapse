import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../../../adminUi'
import SearchableSelect from '../../../SearchableSelect'
import { searchTracks } from '../../../actions'
import { updateSyncEntry, deleteSyncEntry } from '../../actions'

export default async function EditSyncEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: entry, error }, { data: syncWorks }] = await Promise.all([
    supabase
      .from('sync_entry')
      .select(
        'id, usage_detail, sync_work_id, track_id, sync_work:sync_work_id(title), track:track_id(title, artist:artist_id(name), album:album_id(title))'
      )
      .eq('id', id)
      .single(),
    supabase.from('sync_work').select('id, title, year').order('title'),
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

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data/sync" className="text-xs text-white/40 hover:text-white/70">
        ← タイアップ一覧に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">起用楽曲を編集</h1>

      <form action={updateSyncEntry} className="mt-6 flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={entry.id} />
        <input type="hidden" name="previous_track_id" value={entry.track_id ?? ''} />
        <select name="sync_work_id" required className={`${inputClass} max-w-xs`} defaultValue={entry.sync_work_id}>
          {(syncWorks ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.title}
              {w.year ? `(${w.year})` : ''}
            </option>
          ))}
        </select>
        <span className="text-xs text-white/40">で</span>
        {trackLabel && (
          <SearchableSelect
            searchAction={searchTracks}
            name="track_id"
            placeholder="トラックを選択"
            defaultSelected={[{ id: entry.track_id, label: trackLabel }]}
          />
        )}
        <span className="text-xs text-white/40">を使用</span>
        <input
          name="usage_detail"
          placeholder="使用箇所(任意。例: OPテーマ)"
          defaultValue={entry.usage_detail ?? ''}
          className={`${inputClass} max-w-xs`}
        />
        <button type="submit" className={buttonClass}>
          更新する
        </button>
      </form>

      <form action={deleteSyncEntry} className="mt-6">
        <input type="hidden" name="id" value={entry.id} />
        <input type="hidden" name="track_id" value={entry.track_id ?? ''} />
        <input type="hidden" name="sync_work_id" value={entry.sync_work_id} />
        <button
          type="submit"
          className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
        >
          この起用楽曲を削除
        </button>
      </form>
    </div>
  )
}
