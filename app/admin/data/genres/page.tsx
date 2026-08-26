import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { fetchAllRows } from '@/utils/fetchAllRows'
import { inputClass, buttonClass } from '../adminUi'
import SearchableSelect from '../SearchableSelect'
import { searchAlbums, searchArtists } from '../actions'
import { createGenre, linkArtistGenre, addGenreHighlight, deleteGenreHighlight } from './actions'
import WikipediaGenreSearch from './WikipediaGenreSearch'
import ArtistGenreListClient from './ArtistGenreListClient'
import GenreHighlightListClient from './GenreHighlightListClient'

export default async function GenresPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  type ArtistGenreRow = {
    artist: { name: string } | { name: string }[] | null
    genre: { name: string } | { name: string }[] | null
  }

  const [{ data: artists }, { data: genres }, artistGenres, { data: highlights }] = await Promise.all([
    supabase.from('artist').select('id, name').order('name'),
    supabase.from('genre').select('id, name').order('name'),
    // artist_genreは1223件でPostgRESTの上限(1000件)を超え、単純な.select()だと
    // 後半のタグ付けが一覧から丸ごと消えていた
    fetchAllRows<ArtistGenreRow>(supabase, 'artist_genre', 'artist:artist_id(name), genre:genre_id(name)', 'artist_id'),
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
        <GenreHighlightListClient
          deleteAction={deleteGenreHighlight}
          rows={highlights.map((row) => {
            const genre = Array.isArray(row.genre) ? row.genre[0] : row.genre
            const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
            const album = Array.isArray(row.album) ? row.album[0] : row.album
            return {
              id: row.id,
              genreId: genre?.id ?? '',
              genreName: genre?.name ?? '?',
              artistName: artist?.name ?? '?',
              albumTitle: album?.title ?? null,
              note: row.note,
            }
          })}
        />
      )}

      {artistGenres.length > 0 && (
        <div className="mt-8 border-t border-white/10 pt-6">
          <h2 className="text-sm font-semibold text-white/70">アーティスト×ジャンル紐付け一覧</h2>
          <ArtistGenreListClient
            rows={artistGenres.map((row) => {
              const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
              const genre = Array.isArray(row.genre) ? row.genre[0] : row.genre
              return { artistName: artist?.name ?? '', genreName: genre?.name ?? '' }
            })}
          />
        </div>
      )}
    </div>
  )
}
