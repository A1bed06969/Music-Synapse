import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../adminUi'
import { createGenre, linkArtistGenre } from './actions'

export default async function GenresPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  const [{ data: artists }, { data: genres }, { data: artistGenres }] = await Promise.all([
    supabase.from('artist').select('id, name').order('name'),
    supabase.from('genre').select('id, name').order('name'),
    supabase.from('artist_genre').select('artist:artist_id(name), genre:genre_id(name)').order('artist_id'),
  ])

  const artistOptions = artists ?? []
  const genreOptions = genres ?? []

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">ジャンル</h1>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <form action={createGenre} className="mt-6 flex flex-wrap gap-2">
        <input name="name" placeholder="ジャンル名(例: シティポップ)" required className={`${inputClass} max-w-xs`} />
        <input name="origin_year" type="number" placeholder="発祥年(任意)" className={`${inputClass} max-w-[140px]`} />
        <button type="submit" className={buttonClass}>
          ジャンルを追加
        </button>
      </form>

      <form action={linkArtistGenre} className="mt-4 flex flex-wrap items-center gap-2">
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
        <span className="text-xs text-white/40">に</span>
        <select name="genre_id" required className={`${inputClass} max-w-xs`} defaultValue="">
          <option value="" disabled>
            ジャンルを選択
          </option>
          {genreOptions.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-white/40">を紐付け</span>
        <button type="submit" className={buttonClass}>
          紐付ける
        </button>
      </form>

      {artistGenres && artistGenres.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-white/60">
          {artistGenres.map((row, i) => {
            const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
            const genre = Array.isArray(row.genre) ? row.genre[0] : row.genre
            return (
              <li key={i}>
                {artist?.name} — {genre?.name}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
