'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

type GenreRow = {
  id: string
  name: string
  origin_year: number | null
  origin_year_label: string | null
  origin_country: string | null
  isSub: boolean
  imageUrl: string | null
}

function MainGenreCards({ genres }: { genres: GenreRow[] }) {
  return (
    <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {genres.map((genre) => (
        <li key={genre.id}>
          <Link href={`/genres/${genre.id}`} className="group block">
            <div className="relative aspect-square overflow-hidden rounded-lg bg-white/[0.04]">
              {genre.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={genre.imageUrl}
                  alt=""
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-white/15">
                  {genre.name.slice(0, 1)}
                </div>
              )}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
              <p className="absolute inset-x-0 bottom-0 p-3 text-base font-bold uppercase tracking-wide text-white">{genre.name}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function GenreGrid({ genres }: { genres: GenreRow[] }) {
  return (
    <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
      {genres.map((genre) => (
        <li key={genre.id} className="border-b border-white/5 py-2.5">
          <Link href={`/genres/${genre.id}`} className="text-sm font-medium hover:opacity-70">
            {genre.name}
          </Link>
          {(genre.origin_year_label || genre.origin_year || genre.origin_country) && (
            <p className="text-xs text-white/40">
              {[genre.origin_year_label || (genre.origin_year ? `${genre.origin_year}年` : null), genre.origin_country]
                .filter(Boolean)
                .join(' / ')}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

export default function GenreListClient({ genres }: { genres: GenreRow[] }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return genres
    return genres.filter((g) => g.name.toLowerCase().includes(q))
  }, [genres, query])

  const mainGenres = filtered.filter((g) => !g.isSub)
  const subGenres = filtered.filter((g) => g.isSub)

  return (
    <>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="ジャンル名で絞り込み..."
        className="mt-6 w-full max-w-md rounded-md border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
        autoFocus
      />
      <p className="mt-3 text-xs text-white/40">{filtered.length}件</p>

      {filtered.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">該当するジャンルが見つかりませんでした。</p>
      ) : (
        <>
          {mainGenres.length > 0 && (
            <section className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-white/50">メインジャンル</h2>
              <MainGenreCards genres={mainGenres} />
            </section>
          )}
          {subGenres.length > 0 && (
            <section className="mt-10">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-white/50">サブジャンル</h2>
              <GenreGrid genres={subGenres} />
            </section>
          )}
        </>
      )}
    </>
  )
}
