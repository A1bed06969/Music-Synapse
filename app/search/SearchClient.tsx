'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { search } from './actions'

type Artist = {
  id: string
  name: string
  name_kana: string | null
  name_en: string | null
}

type Album = {
  id: string
  title: string
  title_kana: string | null
  jacket_url: string | null
  artist: { id: string; name: string } | { id: string; name: string }[] | null
}

export default function SearchClient() {
  const searchParams = useSearchParams()
  const initialQuery = searchParams.get('q') ?? ''

  const [query, setQuery] = useState(initialQuery)
  const [artists, setArtists] = useState<Artist[]>([])
  const [albums, setAlbums] = useState<Album[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  async function runSearch(q: string) {
    setLoading(true)
    const result = await search(q)
    setArtists(result.artists ?? [])
    setAlbums(result.albums ?? [])
    setLoading(false)
    setSearched(true)
  }

  useEffect(() => {
    if (initialQuery) {
      runSearch(initialQuery)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await runSearch(query)
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold">検索</h1>

      <form onSubmit={handleSubmit} className="mt-6 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="アーティスト・アルバムで検索..."
          className="flex-1 rounded-md border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
          autoFocus
        />
        <button
          type="submit"
          className="rounded-md bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-white/85"
        >
          検索
        </button>
      </form>

      {loading && <p className="mt-8 text-sm text-white/40">検索中...</p>}

      {!loading && searched && artists.length === 0 && albums.length === 0 && (
        <p className="mt-8 text-sm text-white/40">該当する結果が見つかりませんでした。</p>
      )}

      {!loading && artists.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-medium uppercase tracking-wide text-white/40">アーティスト</h2>
          <ul className="mt-3 divide-y divide-white/10">
            {artists.map((artist) => (
              <li key={artist.id}>
                <Link
                  href={`/artists/${artist.id}`}
                  className="flex items-baseline justify-between gap-3 py-3 transition hover:opacity-70"
                >
                  <span className="font-medium">{artist.name}</span>
                  {artist.name_kana && (
                    <span className="text-xs text-white/40">{artist.name_kana}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!loading && albums.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-medium uppercase tracking-wide text-white/40">アルバム</h2>
          <ul className="mt-3 divide-y divide-white/10">
            {albums.map((album) => {
              const artist = Array.isArray(album.artist) ? album.artist[0] : album.artist
              return (
                <li key={album.id}>
                  <Link
                    href={`/albums/${album.id}`}
                    className="flex items-center justify-between gap-3 py-3 transition hover:opacity-70"
                  >
                    <span className="font-medium">{album.title}</span>
                    {artist && <span className="text-xs text-white/40">{artist.name}</span>}
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
