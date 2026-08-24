'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

type GenreRow = {
  id: string
  name: string
  origin_year: number | null
  origin_year_label: string | null
  origin_country: string | null
}

export default function GenreListClient({ genres }: { genres: GenreRow[] }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return genres
    return genres.filter((g) => g.name.toLowerCase().includes(q))
  }, [genres, query])

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
        <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((genre) => (
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
      )}
    </>
  )
}
