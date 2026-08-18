import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../adminUi'
import SearchableSelect from '../SearchableSelect'
import { searchTracks } from '../actions'
import { createTieUp } from './actions'

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'anime', label: 'アニメ' },
  { value: 'drama', label: 'ドラマ' },
  { value: 'movie', label: '映画' },
  { value: 'cm', label: 'CM' },
  { value: 'game', label: 'ゲーム' },
  { value: 'other', label: 'その他' },
]

export default async function TieUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  const { data: tieUps } = await supabase
    .from('tie_up')
    .select('id, category, work_title, year, note, track:track_id(title, artist:artist_id(name))')
    .order('year', { ascending: false, nullsFirst: false })

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">タイアップ</h1>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <form action={createTieUp} className="mt-6 flex flex-wrap items-center gap-2">
        <SearchableSelect searchAction={searchTracks} name="track_id" placeholder="楽曲を選択" />
        <select name="category" required className={`${inputClass} max-w-[140px]`} defaultValue="">
          <option value="" disabled>
            種別
          </option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input name="work_title" placeholder="作品名" required className={`${inputClass} max-w-xs`} />
        <input name="year" type="number" placeholder="年(任意)" className={`${inputClass} max-w-[120px]`} />
        <input name="note" placeholder="補足(任意、OP/ED等)" className={`${inputClass} max-w-xs`} />
        <button type="submit" className={buttonClass}>
          タイアップを追加
        </button>
      </form>

      {tieUps && tieUps.length > 0 && (
        <ul className="mt-6 space-y-1.5 text-sm text-white/60">
          {tieUps.map((row) => {
            const track = Array.isArray(row.track) ? row.track[0] : row.track
            const artist = track ? (Array.isArray(track.artist) ? track.artist[0] : track.artist) : null
            const categoryLabel = CATEGORY_OPTIONS.find((c) => c.value === row.category)?.label ?? row.category
            return (
              <li key={row.id}>
                {track?.title ?? '(不明な楽曲)'}
                {artist?.name ? ` — ${artist.name}` : ''} 「{row.work_title}」({categoryLabel}
                {row.year ? `・${row.year}年` : ''})
                {row.note ? ` ${row.note}` : ''}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
