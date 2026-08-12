import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../adminUi'
import SearchableSelect from '../SearchableSelect'
import { searchAlbums } from '../actions'
import { createDiscGuide, createDiscGuideSelection } from './actions'

export default async function DiscGuidesAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  const [{ data: discGuides }, { data: selections }] = await Promise.all([
    supabase.from('disc_guide').select('id, title, publisher, published_year').order('title'),
    supabase
      .from('disc_guide_selection')
      .select('id, note, disc_guide:disc_guide_id(title), album:album_id(title)')
      .order('id', { ascending: false }),
  ])

  const discGuideOptions = discGuides ?? []

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">ディスクガイド</h1>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <form action={createDiscGuide} className="mt-6 flex flex-wrap gap-2">
        <input name="title" placeholder="書籍名(例: 日本の名盤100)" required className={`${inputClass} max-w-xs`} />
        <input name="publisher" placeholder="出版社(任意)" className={`${inputClass} max-w-[160px]`} />
        <input name="published_year" type="number" placeholder="発行年(任意)" className={`${inputClass} max-w-[120px]`} />
        <input name="isbn" placeholder="ISBN(任意)" className={`${inputClass} max-w-[160px]`} />
        <button type="submit" className={buttonClass}>
          書籍を追加
        </button>
      </form>

      {discGuideOptions.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2 text-sm text-white/60">
          {discGuideOptions.map((d) => (
            <li key={d.id} className="rounded-full border border-white/15 px-2.5 py-0.5 text-xs">
              {d.title}
              {d.published_year ? `(${d.published_year})` : ''}
            </li>
          ))}
        </ul>
      )}

      <form action={createDiscGuideSelection} className="mt-6 flex flex-wrap items-center gap-2">
        <select name="disc_guide_id" required className={`${inputClass} max-w-xs`} defaultValue="">
          <option value="" disabled>
            書籍を選択
          </option>
          {discGuideOptions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
        <span className="text-xs text-white/40">に</span>
        <SearchableSelect searchAction={searchAlbums} name="album_id" placeholder="アルバムを選択" />
        <input name="note" placeholder="メモ(任意。例: #7掲載)" className={`${inputClass} max-w-xs`} />
        <button type="submit" className={buttonClass}>
          掲載データを追加
        </button>
      </form>

      {selections && selections.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-white/60">
          {selections.map((row) => {
            const guide = Array.isArray(row.disc_guide) ? row.disc_guide[0] : row.disc_guide
            const album = Array.isArray(row.album) ? row.album[0] : row.album
            return (
              <li key={row.id}>
                {guide?.title} — {album?.title}
                {row.note ? `(${row.note})` : ''}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
