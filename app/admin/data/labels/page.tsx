import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../adminUi'
import SearchableSelect from '../SearchableSelect'
import { searchAlbums } from '../actions'
import { createLabel, linkArtistLabel, linkAlbumLabel } from './actions'

export default async function LabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  const [{ data: artists }, { data: labels }, { data: artistLabels }, { data: albumLabels }] = await Promise.all([
    supabase.from('artist').select('id, name').order('name'),
    supabase.from('label').select('id, name').order('name'),
    supabase.from('artist_label').select('artist:artist_id(name), label:label_id(name), start_date').order('artist_id'),
    supabase.from('album').select('title, label:label_id(name)').not('label_id', 'is', null).order('title'),
  ])

  const artistOptions = artists ?? []
  const labelOptions = labels ?? []

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">レーベル</h1>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <form action={createLabel} className="mt-6 space-y-2">
        <div className="flex flex-wrap gap-2">
          <input name="name" placeholder="レーベル名" required className={`${inputClass} max-w-xs`} />
          <input name="name_kana" placeholder="ふりがな(任意)" className={`${inputClass} max-w-xs`} />
          <input name="founded_year" type="number" placeholder="設立年(任意)" className={`${inputClass} max-w-[140px]`} />
        </div>
        <input name="description" placeholder="概要(任意)" className={inputClass} />
        <button type="submit" className={buttonClass}>
          レーベルを追加
        </button>
      </form>

      <form action={linkArtistLabel} className="mt-4 flex flex-wrap items-center gap-2">
        <select name="artist_id" required className={`${inputClass} max-w-xs`} defaultValue="">
          <option value="" disabled>
            アーティストを選択
          </option>
          {artistOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-white/40">を</span>
        <select name="label_id" required className={`${inputClass} max-w-xs`} defaultValue="">
          <option value="" disabled>
            レーベルを選択
          </option>
          {labelOptions.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <input name="start_date" type="date" className={`${inputClass} max-w-[160px]`} />
        <button type="submit" className={buttonClass}>
          所属を追加
        </button>
      </form>

      {artistLabels && artistLabels.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-white/60">
          {artistLabels.map((row, i) => {
            const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
            const label = Array.isArray(row.label) ? row.label[0] : row.label
            return (
              <li key={i}>
                {artist?.name} — {label?.name}
              </li>
            )
          })}
        </ul>
      )}

      <form action={linkAlbumLabel} className="mt-6 flex flex-wrap items-center gap-2">
        <SearchableSelect searchAction={searchAlbums} name="album_id" placeholder="アルバムを選択" />
        <span className="text-xs text-white/40">を</span>
        <select name="label_id" required className={`${inputClass} max-w-xs`} defaultValue="">
          <option value="" disabled>
            レーベルを選択
          </option>
          {labelOptions.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonClass}>
          アルバムを紐付け
        </button>
      </form>

      {albumLabels && albumLabels.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-white/60">
          {albumLabels.map((row, i) => {
            const label = Array.isArray(row.label) ? row.label[0] : row.label
            return (
              <li key={i}>
                {row.title} — {label?.name}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
