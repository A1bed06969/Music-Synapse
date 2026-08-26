import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../../../../adminUi'
import SearchableSelect from '../../../../SearchableSelect'
import { searchArtists } from '../../../../actions'
import { updateMusicEvent, deleteMusicEvent } from '../../../actions'

export default async function EditMusicEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: entry, error } = await supabase
    .from('music_event')
    .select('id, artist_id, name, event_date, venue, prefecture, description, artist:artist_id(name)')
    .eq('id', id)
    .single()

  if (error || !entry) {
    notFound()
  }

  const artist = Array.isArray(entry.artist) ? entry.artist[0] : entry.artist

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data/events" className="text-xs text-white/40 hover:text-white/70">
        ← イベント一覧に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">単独公演を編集</h1>

      <form action={updateMusicEvent} className="mt-6 flex flex-wrap gap-2">
        <input type="hidden" name="id" value={entry.id} />
        <SearchableSelect
          searchAction={searchArtists}
          name="artist_id"
          placeholder="アーティストを検索..."
          defaultSelected={artist?.name ? [{ id: entry.artist_id, label: artist.name }] : []}
        />
        <input
          name="name"
          placeholder="公演名(例: ○○ホール ワンマンライブ)"
          required
          defaultValue={entry.name}
          className={`${inputClass} max-w-xs`}
        />
        <input
          name="event_date"
          type="date"
          defaultValue={entry.event_date ?? ''}
          className={`${inputClass} max-w-[160px]`}
        />
        <input name="venue" placeholder="会場(任意)" defaultValue={entry.venue ?? ''} className={`${inputClass} max-w-xs`} />
        <input
          name="prefecture"
          placeholder="都道府県(任意)"
          defaultValue={entry.prefecture ?? ''}
          className={`${inputClass} max-w-[160px]`}
        />
        <button type="submit" className={buttonClass}>
          更新する
        </button>
      </form>

      <form action={deleteMusicEvent} className="mt-6">
        <input type="hidden" name="id" value={entry.id} />
        <input type="hidden" name="artist_id" value={entry.artist_id} />
        <button
          type="submit"
          className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
        >
          この単独公演を削除
        </button>
      </form>
    </div>
  )
}
