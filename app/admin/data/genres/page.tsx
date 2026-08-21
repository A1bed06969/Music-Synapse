import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../adminUi'
import SearchableSelect from '../SearchableSelect'
import { searchAlbums, searchArtists } from '../actions'
import { createGenre, linkArtistGenre, addGenreHighlight, deleteGenreHighlight } from './actions'
import WikipediaGenreSearch from './WikipediaGenreSearch'

export default async function GenresPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  const [{ data: artists }, { data: genres }, { data: artistGenres }, { data: highlights }] = await Promise.all([
    supabase.from('artist').select('id, name').order('name'),
    supabase.from('genre').select('id, name').order('name'),
    supabase.from('artist_genre').select('artist:artist_id(name), genre:genre_id(name)').order('artist_id'),
    supabase
      .from('genre_highlight')
      .select('id, note, genre:genre_id(id, name), artist:artist_id(name), album:album_id(title)')
      .order('id', { ascending: false }),
  ])

  const artistOptions = artists ?? []
  const genreOptions = genres ?? []

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">ジャンル</h1>

      <WikipediaGenreSearch genreOptions={genreOptions} />

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

      {genreOptions.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2 text-sm text-white/60">
          {genreOptions.map((g) => (
            <li key={g.id} className="flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-0.5 text-xs">
              {g.name}
              <Link href={`/genres/${g.id}`} className="text-white/40 hover:text-white/70">
                →
              </Link>
            </li>
          ))}
        </ul>
      )}

      <form action={addGenreHighlight} className="mt-6 flex flex-wrap items-center gap-2">
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
        <span className="text-xs text-white/40">の代表に</span>
        <SearchableSelect searchAction={searchArtists} name="artist_id" placeholder="アーティスト(任意)" />
        <SearchableSelect searchAction={searchAlbums} name="album_id" placeholder="作品(任意)" />
        <input name="note" placeholder="メモ(任意)" className={`${inputClass} max-w-[160px]`} />
        <button type="submit" className={buttonClass}>
          代表として登録
        </button>
      </form>

      {highlights && highlights.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-white/60">
          {highlights.map((row) => {
            const genre = Array.isArray(row.genre) ? row.genre[0] : row.genre
            const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
            const album = Array.isArray(row.album) ? row.album[0] : row.album
            return (
              <li key={row.id} className="flex items-center justify-between gap-2">
                <span>
                  {genre?.name} — {artist?.name}
                  {album?.title ? `「${album.title}」` : ''}
                  {row.note ? `(${row.note})` : ''}
                </span>
                <form action={deleteGenreHighlight}>
                  <input type="hidden" name="id" value={row.id} />
                  <input type="hidden" name="genre_id" value={genre?.id ?? ''} />
                  <button type="submit" className="shrink-0 text-xs text-white/40 hover:text-red-400">
                    削除
                  </button>
                </form>
              </li>
            )
          })}
        </ul>
      )}

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
