'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

type Album = {
  id: string
  title: string
  title_kana: string | null
  jacket_url: string | null
  artistName: string | null
}

export default function AlbumBrowseClient({ albums }: { albums: Album[] }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return albums
    return albums.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        (a.title_kana ?? '').toLowerCase().includes(q) ||
        (a.artistName ?? '').toLowerCase().includes(q)
    )
  }, [albums, query])

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-2xl font-bold">アルバム</h1>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="アルバム名・アーティスト名で絞り込み..."
        className="mt-6 w-full max-w-md rounded-md border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
        autoFocus
      />

      <p className="mt-3 text-xs text-white/40">{filtered.length}件</p>

      {filtered.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">該当するアルバムが見つかりませんでした。</p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-6">
          {filtered.map((album) => (
            <Link key={album.id} href={`/albums/${album.id}`} className="group block">
              <div className="aspect-square overflow-hidden rounded-md bg-white/5">
                {album.jacket_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={album.jacket_url}
                    alt={album.title}
                    loading="lazy"
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-white/20">No Art</div>
                )}
              </div>
              <p className="mt-2 truncate text-xs font-medium">{album.title}</p>
              {album.artistName && <p className="truncate text-xs text-white/40">{album.artistName}</p>}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
