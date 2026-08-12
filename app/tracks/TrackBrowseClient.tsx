'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { formatDuration } from '@/utils/format'

type Track = {
  id: string
  title: string
  duration_seconds: number | null
  ranked: boolean
  onAir: boolean
}

type ArtistGroup = {
  id: string
  name: string
  image_url: string | null
  tracks: Track[]
}

export default function TrackBrowseClient({ groups }: { groups: ArtistGroup[] }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return groups
    return groups
      .map((g) => {
        if (g.name.toLowerCase().includes(q)) return g
        const tracks = g.tracks.filter((t) => t.title.toLowerCase().includes(q))
        return tracks.length > 0 ? { ...g, tracks } : null
      })
      .filter((g): g is ArtistGroup => g !== null)
  }, [groups, query])

  const totalTracks = useMemo(() => filtered.reduce((sum, g) => sum + g.tracks.length, 0), [filtered])

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">トラック</h1>
      <p className="mt-2 text-xs text-white/40">
        アーティストごとに、ランキング掲載・オンエア実績のある曲(🏆/📻)を先頭にして並べています。
      </p>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="曲名・アーティスト名で絞り込み..."
        className="mt-6 w-full max-w-md rounded-md border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
        autoFocus
      />

      <p className="mt-3 text-xs text-white/40">{totalTracks}曲</p>

      {filtered.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">該当する曲が見つかりませんでした。</p>
      ) : (
        <div className="mt-6 space-y-8">
          {filtered.map((group) => (
            <section key={group.id}>
              <Link href={`/artists/${group.id}`} className="flex items-center gap-2 hover:opacity-70">
                {group.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={group.image_url} alt="" className="h-6 w-6 rounded-full object-cover" />
                ) : (
                  <div className="h-6 w-6 rounded-full bg-white/5" />
                )}
                <h2 className="text-sm font-semibold">{group.name}</h2>
              </Link>
              <ul className="mt-2 divide-y divide-white/10 border-t border-white/10">
                {group.tracks.map((track) => (
                  <li key={track.id}>
                    <Link
                      href={`/tracks/${track.id}`}
                      className="flex items-center justify-between gap-3 py-2 text-sm transition hover:opacity-70"
                    >
                      <span>
                        {(track.ranked || track.onAir) && (
                          <span className="mr-1.5">
                            {track.ranked && '🏆'}
                            {track.onAir && '📻'}
                          </span>
                        )}
                        {track.title}
                      </span>
                      <span className="shrink-0 text-xs text-white/30">{formatDuration(track.duration_seconds)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
