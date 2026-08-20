import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../adminUi'
import SearchableSelect from '../SearchableSelect'
import { searchAlbums } from '../actions'
import { createDiscGuide, createDiscGuideSelection } from './actions'
import DiscGuideImageUpload from './DiscGuideImageUpload'
import DiscGuideDriveImport from './DiscGuideDriveImport'

export default async function DiscGuidesAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  const [{ data: discGuides }, { data: selections }] = await Promise.all([
    supabase
      .from('disc_guide')
      .select('id, title, publisher, published_year, cover_image_url, isbn_lookup_error')
      .order('title'),
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

      <div className="mt-10 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">アルバム抽出</h2>
          <Link
            href="/admin/data/discguides/confirm"
            className="text-xs text-blue-300 hover:text-blue-200"
          >
            スキャン確認へ →
          </Link>
        </div>

        {discGuideOptions.length === 0 && (
          <p className="text-sm text-white/30">まず書籍を追加してください。</p>
        )}

        {discGuideOptions.map((guide) => (
          <div key={guide.id} className="rounded border border-white/10 p-4">
            <div className="flex items-start gap-4">
              {guide.cover_image_url ? (
                <img
                  src={guide.cover_image_url}
                  alt={guide.title}
                  className="h-32 w-24 shrink-0 rounded object-cover"
                />
              ) : (
                <div className="flex h-32 w-24 shrink-0 items-center justify-center rounded bg-white/5 text-[10px] text-white/30">
                  表紙なし
                </div>
              )}
              <div className="min-w-0">
                <h3 className="font-semibold">{guide.title}</h3>
                <p className="mt-1 text-sm text-white/60">
                  {guide.publisher}
                  {guide.published_year ? ` (${guide.published_year})` : ''}
                </p>
                {guide.isbn_lookup_error && (
                  <p className="mt-1 text-xs text-red-400">
                    表紙取得エラー: {guide.isbn_lookup_error}
                  </p>
                )}
              </div>
            </div>

            <DiscGuideImageUpload discGuideId={guide.id} />
            <DiscGuideDriveImport discGuideId={guide.id} />
          </div>
        ))}
      </div>
    </div>
  )
}
