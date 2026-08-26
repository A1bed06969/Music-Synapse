import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../adminUi'
import SearchableSelect from '../SearchableSelect'
import SimpleFilterList from '../SimpleFilterList'
import { searchAlbums, searchArtists } from '../actions'
import { createLabel, linkArtistLabel, linkAlbumLabel, mergeLabel } from './actions'
import MusicBrainzLabelSearch from './MusicBrainzLabelSearch'

export default async function LabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  const [{ data: labels }, { data: artistLabels }, { data: albumLabels }] = await Promise.all([
    supabase.from('label').select('id, name').order('name'),
    supabase.from('artist_label').select('artist:artist_id(name), label:label_id(name), start_date').order('artist_id'),
    supabase.from('album').select('title, label:label_id(name)').not('label_id', 'is', null).order('title'),
  ])

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

      <MusicBrainzLabelSearch />

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
        <SearchableSelect searchAction={searchArtists} name="artist_id" placeholder="アーティストを検索..." />
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
        <SimpleFilterList
          placeholder="アーティスト名・レーベル名で絞り込み..."
          items={artistLabels.map((row, i) => {
            const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
            const label = Array.isArray(row.label) ? row.label[0] : row.label
            const text = `${artist?.name ?? ''} — ${label?.name ?? ''}`
            return { key: i, text, filterText: text }
          })}
        />
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
        <SimpleFilterList
          placeholder="アルバム名・レーベル名で絞り込み..."
          items={albumLabels.map((row, i) => {
            const label = Array.isArray(row.label) ? row.label[0] : row.label
            const text = `${row.title} — ${label?.name ?? ''}`
            return { key: i, text, filterText: text }
          })}
        />
      )}

      <div className="mt-10 rounded-md border border-red-500/20 p-4">
        <h2 className="text-sm font-semibold">レーベル統合</h2>
        <p className="mt-1 text-xs text-white/40">
          表記違いなどで重複登録されたレーベルを1件へまとめる。統合元のアルバム・所属アーティスト・創設者は全て統合先へ付け替わり、統合元は削除される。取り消せない操作。
        </p>
        <form action={mergeLabel} className="mt-3 flex flex-wrap items-center gap-2">
          <select name="source_label_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              統合元(削除する方)
            </option>
            {labelOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-white/40">を</span>
          <select name="target_label_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              統合先(残す方)
            </option>
            {labelOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-white/40">へ統合</span>
          <button type="submit" className="rounded-md border border-red-500/30 px-4 py-2 text-sm hover:bg-red-500/10">
            統合を実行
          </button>
        </form>
      </div>
    </div>
  )
}
