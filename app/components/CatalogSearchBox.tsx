'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { search, type SearchArtist, type SearchAlbum, type SearchTrack } from '@/app/search/actions'

const DEBOUNCE_MS = 300
// 「愛」「桜」のような1文字の日本語検索も意味を持つため1文字から検索する。
// DB側はPGroongaの2-gramインデックスで引いており、候補を200件で打ち切るため
// ヒット数の多い語でも応答が保証される(supabase/migrations/20260909_add_search_catalog.sql)。
const MIN_QUERY_LENGTH = 1

type Artist = SearchArtist
type Album = SearchAlbum
type Track = SearchTrack

const inputClass =
  'flex-1 rounded-md border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none'

/**
 * 自DBのartist/albumをライブ検索するボックス。TOPページ(overlay: 入力欄の下に
 * ドロップダウンで候補を出す)と/searchページ(page: インラインに一覧表示)の
 * 両方から共通で使う
 */
export default function CatalogSearchBox({
  variant,
  initialQuery = '',
  autoFocus = false,
}: {
  variant: 'overlay' | 'page'
  initialQuery?: string
  autoFocus?: boolean
}) {
  const [query, setQuery] = useState(initialQuery)
  const [artists, setArtists] = useState<Artist[]>([])
  const [albums, setAlbums] = useState<Album[]>([])
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [focused, setFocused] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didInitialSearch = useRef(false)

  const trimmedQuery = query.trim()
  const queryTooShort = trimmedQuery.length < MIN_QUERY_LENGTH

  async function runSearch(q: string) {
    setLoading(true)
    const result = await search(q)
    setArtists(result.artists ?? [])
    setAlbums(result.albums ?? [])
    setTracks(result.tracks ?? [])
    setLoading(false)
    setSearched(true)
  }

  // /search?q=... で直接開かれた場合、初回だけ即座に検索する
  useEffect(() => {
    if (!didInitialSearch.current && initialQuery.trim().length >= MIN_QUERY_LENGTH) {
      didInitialSearch.current = true
      runSearch(initialQuery)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (queryTooShort) return

    debounceRef.current = setTimeout(() => {
      runSearch(query)
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, queryTooShort])

  const activeArtists = queryTooShort ? [] : artists
  const activeAlbums = queryTooShort ? [] : albums
  const activeTracks = queryTooShort ? [] : tracks
  const hasResults = activeArtists.length > 0 || activeAlbums.length > 0 || activeTracks.length > 0
  const showOverlayPanel = variant === 'overlay' && focused && !queryTooShort

  return (
    <div className={variant === 'overlay' ? 'relative' : ''}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!queryTooShort) runSearch(query)
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="アーティスト・アルバム・曲を検索"
          className={inputClass}
          autoFocus={autoFocus}
        />
        <button
          type="submit"
          className="rounded-md bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-white/85"
        >
          検索
        </button>
      </form>

      {variant === 'overlay' ? (
        showOverlayPanel && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-white/15 bg-[#0a0a0a] p-2 text-left shadow-lg">
            {loading && <p className="px-2 py-1.5 text-sm text-white/40">検索中...</p>}
            {!loading && searched && !hasResults && (
              <p className="px-2 py-1.5 text-sm text-white/40">該当する結果が見つかりませんでした。</p>
            )}
            {!loading && hasResults && (
              <SearchResultsList artists={activeArtists} albums={activeAlbums} tracks={activeTracks} dense />
            )}
          </div>
        )
      ) : (
        <div className="mt-8">
          {loading && <p className="text-sm text-white/40">検索中...</p>}
          {!loading && searched && !queryTooShort && !hasResults && (
            <p className="text-sm text-white/40">該当する結果が見つかりませんでした。</p>
          )}
          {!loading && hasResults && (
            <SearchResultsList artists={activeArtists} albums={activeAlbums} tracks={activeTracks} dense={false} />
          )}
        </div>
      )}
    </div>
  )
}

function SearchResultsList({
  artists,
  albums,
  tracks,
  dense,
}: {
  artists: Artist[]
  albums: Album[]
  tracks: Track[]
  dense: boolean
}) {
  const headingClass = `text-xs font-medium uppercase tracking-wide text-white/40 ${dense ? 'px-2 pt-2' : ''}`
  const itemClass = dense
    ? 'flex items-baseline justify-between gap-3 rounded-md px-2 py-2 transition hover:bg-white/5'
    : 'flex items-baseline justify-between gap-3 py-3 transition hover:opacity-70'

  return (
    <>
      {artists.length > 0 && (
        <section className={dense ? '' : 'mt-8'}>
          <h2 className={headingClass}>アーティスト</h2>
          <ul className={dense ? 'mt-1' : 'mt-3 divide-y divide-white/10'}>
            {artists.map((artist) => (
              <li key={artist.id}>
                <Link href={`/artists/${artist.id}`} className={itemClass}>
                  <span className="font-medium">{artist.name}</span>
                  {artist.name_kana && <span className="text-xs text-white/40">{artist.name_kana}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {albums.length > 0 && (
        <section className={dense ? 'mt-1' : 'mt-8'}>
          <h2 className={headingClass}>アルバム</h2>
          <ul className={dense ? 'mt-1' : 'mt-3 divide-y divide-white/10'}>
            {albums.map((album) => (
              <li key={album.id}>
                <Link href={`/albums/${album.id}`} className={itemClass}>
                  <span className="font-medium">{album.title}</span>
                  {album.artist && <span className="text-xs text-white/40">{album.artist.name}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tracks.length > 0 && (
        <section className={dense ? 'mt-1' : 'mt-8'}>
          <h2 className={headingClass}>曲</h2>
          <ul className={dense ? 'mt-1' : 'mt-3 divide-y divide-white/10'}>
            {tracks.map((track) => (
              <li key={track.id}>
                <Link href={`/tracks/${track.id}`} className={itemClass}>
                  <span className="font-medium">{track.title}</span>
                  {track.artist && <span className="shrink-0 text-xs text-white/40">{track.artist.name}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
