'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { formatDate, STREAMING_STATUS_LABEL } from '@/utils/format'

type Album = {
  id: string
  title: string
  title_kana: string | null
  jacket_url: string | null
  releaseDate: string | null
  streamingStatus: string | null
  artistName: string | null
}

type SortMode = 'kana' | 'release'
type StatusFilter = 'all' | 'available' | 'apple_only' | 'none'

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'available', label: `${STREAMING_STATUS_LABEL.all.icon} ${STREAMING_STATUS_LABEL.all.label}` },
  {
    value: 'apple_only',
    label: `${STREAMING_STATUS_LABEL.apple_only.icon} ${STREAMING_STATUS_LABEL.apple_only.label}`,
  },
  { value: 'none', label: `${STREAMING_STATUS_LABEL.none.icon} ${STREAMING_STATUS_LABEL.none.label}` },
]

export default function AlbumBrowseClient({
  albums,
  initialSort = 'kana',
}: {
  albums: Album[]
  initialSort?: SortMode
}) {
  const [query, setQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>(initialSort)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let result = albums.filter(
      (a) =>
        !q ||
        a.title.toLowerCase().includes(q) ||
        (a.title_kana ?? '').toLowerCase().includes(q) ||
        (a.artistName ?? '').toLowerCase().includes(q)
    )
    if (statusFilter !== 'all') {
      const target = statusFilter === 'available' ? 'all' : statusFilter
      result = result.filter((a) => a.streamingStatus === target)
    }
    if (sortMode === 'release') {
      result = [...result].sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
    }
    return result
  }, [albums, query, statusFilter, sortMode])

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">アルバム</h1>
        <div className="flex gap-1 rounded-md border border-white/15 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setSortMode('kana')}
            className={`rounded px-3 py-1 ${sortMode === 'kana' ? 'bg-white text-black' : 'text-white/60 hover:text-white'}`}
          >
            50音順
          </button>
          <button
            type="button"
            onClick={() => setSortMode('release')}
            className={`rounded px-3 py-1 ${sortMode === 'release' ? 'bg-white text-black' : 'text-white/60 hover:text-white'}`}
          >
            発売日順
          </button>
        </div>
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="アルバム名・アーティスト名で絞り込み..."
        className="mt-6 w-full max-w-md rounded-md border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
        autoFocus
      />

      <div className="mt-3 flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={`rounded-full border px-3 py-1 text-xs ${
              statusFilter === f.value
                ? 'border-white bg-white text-black'
                : 'border-white/15 text-white/60 hover:border-white/30'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs text-white/40">{filtered.length}件</p>

      {filtered.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">該当するアルバムが見つかりませんでした。</p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-6">
          {filtered.map((album) => {
            const status = album.streamingStatus ? STREAMING_STATUS_LABEL[album.streamingStatus] : null
            return (
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
                {sortMode === 'release' && (
                  <p className="truncate text-xs text-white/30">
                    {formatDate(album.releaseDate)}
                    {status ? ` · ${status.icon}` : ''}
                  </p>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
