'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

type Artist = {
  id: string
  name: string
  name_kana: string | null
  name_en: string | null
  image_url: string | null
}

export default function ArtistBrowseClient({ artists }: { artists: Artist[] }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return artists
    return artists.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.name_kana ?? '').toLowerCase().includes(q) ||
        (a.name_en ?? '').toLowerCase().includes(q)
    )
  }, [artists, query])

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-2xl font-bold">アーティスト</h1>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="アーティスト名で絞り込み..."
        className="mt-6 w-full max-w-md rounded-md border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
        autoFocus
      />

      <p className="mt-3 text-xs text-white/40">{filtered.length}件</p>

      {filtered.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">該当するアーティストが見つかりませんでした。</p>
      ) : (
        <div className="mt-6 grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6">
          {filtered.map((artist) => (
            <Link key={artist.id} href={`/artists/${artist.id}`} className="group block">
              <div className="aspect-square overflow-hidden rounded-full bg-white/5">
                {artist.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={artist.image_url}
                    alt={artist.name}
                    loading="lazy"
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-white/20">?</div>
                )}
              </div>
              <p className="mt-2 truncate text-center text-xs font-medium">{artist.name}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
