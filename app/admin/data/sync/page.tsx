import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../adminUi'
import SearchableSelect from '../SearchableSelect'
import { searchTracks } from '../actions'
import { createSyncWork, createSyncEntry } from './actions'

const WORK_TYPE_OPTIONS = [
  { value: 'cm', label: 'CM' },
  { value: 'anime', label: 'アニメ' },
  { value: 'game', label: 'ゲーム' },
  { value: 'movie', label: '映画' },
  { value: 'tv_program', label: 'テレビ番組' },
]

export default async function SyncAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  const [{ data: syncWorks }, { data: syncEntries }] = await Promise.all([
    supabase.from('sync_work').select('id, title, work_type, year').order('title'),
    supabase
      .from('sync_entry')
      .select('id, usage_detail, sync_work:sync_work_id(title), track:track_id(title)')
      .order('id', { ascending: false }),
  ])

  const syncWorkOptions = syncWorks ?? []

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <div className="mt-4 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">タイアップ・シンクロアーカイブ</h1>
        <Link href="/media/sync" className="text-xs text-white/40 hover:text-white/70">
          公開ページを見る →
        </Link>
      </div>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <form action={createSyncWork} className="mt-6 flex flex-wrap gap-2">
        <input name="title" placeholder="作品名(例: 熱闘甲子園)" required className={`${inputClass} max-w-xs`} />
        <select name="work_type" className={`${inputClass} max-w-[140px]`} defaultValue="">
          <option value="">起用種別(任意)</option>
          {WORK_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <input name="company_or_studio" placeholder="企業・制作会社(任意)" className={`${inputClass} max-w-xs`} />
        <input name="year" type="number" placeholder="年(任意)" className={`${inputClass} max-w-[120px]`} />
        <button type="submit" className={buttonClass}>
          作品を追加
        </button>
      </form>

      <form action={createSyncEntry} className="mt-4 flex flex-wrap items-center gap-2">
        <select name="sync_work_id" required className={`${inputClass} max-w-xs`} defaultValue="">
          <option value="" disabled>
            作品を選択
          </option>
          {syncWorkOptions.map((w) => (
            <option key={w.id} value={w.id}>
              {w.title}
              {w.year ? `(${w.year})` : ''}
            </option>
          ))}
        </select>
        <span className="text-xs text-white/40">で</span>
        <SearchableSelect searchAction={searchTracks} name="track_id" placeholder="トラックを選択" />
        <span className="text-xs text-white/40">を使用</span>
        <input name="usage_detail" placeholder="使用箇所(任意。例: OPテーマ)" className={`${inputClass} max-w-xs`} />
        <button type="submit" className={buttonClass}>
          起用楽曲を追加
        </button>
      </form>

      {syncEntries && syncEntries.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-white/60">
          {syncEntries.map((row) => {
            const work = Array.isArray(row.sync_work) ? row.sync_work[0] : row.sync_work
            const track = Array.isArray(row.track) ? row.track[0] : row.track
            return (
              <li key={row.id}>
                {work?.title} — {track?.title}
                {row.usage_detail ? `(${row.usage_detail})` : ''}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
