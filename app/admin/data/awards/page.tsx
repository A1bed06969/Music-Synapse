import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../adminUi'
import SearchableSelect from '../SearchableSelect'
import { searchTracks, searchAlbums } from '../actions'
import { createAward, createAwardEntry } from './actions'

const AWARD_RESULT_OPTIONS = [
  { value: 'nominee', label: 'ノミネート' },
  { value: 'winner', label: '受賞' },
]

export default async function AwardsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  const [{ data: artists }, { data: awards }, { data: awardEntries }] = await Promise.all([
    supabase.from('artist').select('id, name').order('name'),
    supabase.from('award').select('id, name').order('name'),
    supabase
      .from('award_entry')
      .select(
        'id, year, category, result, award:award_id(name), artist:artist_id(name), album:album_id(title), track:track_id(title)'
      )
      .order('id', { ascending: false }),
  ])

  const artistOptions = artists ?? []
  const awardOptions = awards ?? []

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <div className="mt-4 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">アワード</h1>
        <Link href="/chronology/awards" className="text-xs text-white/40 hover:text-white/70">
          公開ページを見る →
        </Link>
      </div>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <form action={createAward} className="mt-6 flex flex-wrap gap-2">
        <input name="name" placeholder="賞名(例: 日本レコード大賞)" required className={`${inputClass} max-w-xs`} />
        <input name="country" placeholder="国(任意)" className={`${inputClass} max-w-[160px]`} />
        <input name="description" placeholder="概要(任意)" className={`${inputClass} max-w-xs`} />
        <button type="submit" className={buttonClass}>
          賞を追加
        </button>
      </form>

      {awardOptions.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2 text-sm text-white/60">
          {awardOptions.map((a) => (
            <li key={a.id} className="rounded-full border border-white/15 px-2.5 py-0.5 text-xs">
              {a.name}
            </li>
          ))}
        </ul>
      )}

      <form action={createAwardEntry} className="mt-6 space-y-2">
        <div className="flex flex-wrap gap-2">
          <select name="award_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              賞を選択
            </option>
            {awardOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <input name="year" type="number" placeholder="年" required className={`${inputClass} max-w-[100px]`} />
          <input name="category" placeholder="部門(任意)" className={`${inputClass} max-w-xs`} />
          <select name="result" required className={`${inputClass} max-w-[140px]`} defaultValue="">
            <option value="" disabled>
              結果
            </option>
            {AWARD_RESULT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <SearchableSelect searchAction={searchTracks} name="track_id" placeholder="トラックを検索(任意)" />
          <SearchableSelect searchAction={searchAlbums} name="album_id" placeholder="アルバムを検索(任意)" />
          <select name="artist_id" className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="">(アーティスト指定なし)</option>
            {artistOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonClass}>
          受賞・ノミネートを追加
        </button>
      </form>

      {awardEntries && awardEntries.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-white/60">
          {awardEntries.map((row) => {
            const award = Array.isArray(row.award) ? row.award[0] : row.award
            const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
            const album = Array.isArray(row.album) ? row.album[0] : row.album
            const track = Array.isArray(row.track) ? row.track[0] : row.track
            const target = artist?.name ?? album?.title ?? track?.title
            return (
              <li key={row.id}>
                {row.year} {award?.name}
                {row.category ? `(${row.category})` : ''} — {target}
                <span className="text-white/30"> {row.result === 'winner' ? '受賞' : 'ノミネート'}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
