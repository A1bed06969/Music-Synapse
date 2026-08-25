'use client'

import { useMemo, useState } from 'react'
import UnmatchedArtistRow from './UnmatchedArtistRow'

type StubArtist = {
  id: string
  name: string
  createdAt: string
  appearanceContext: string[]
}

export default function UnmatchedArtistListClient({ artists }: { artists: StubArtist[] }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return artists
    return artists.filter((a) => a.name.toLowerCase().includes(q) || a.appearanceContext.some((c) => c.toLowerCase().includes(q)))
  }, [artists, query])

  return (
    <>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="アーティスト名・出演イベント名で絞り込み..."
        className="mt-6 w-full max-w-md rounded-md border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
        autoFocus
      />
      <p className="mt-3 text-xs text-white/40">{filtered.length}件</p>

      {filtered.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">該当するアーティストが見つかりませんでした。</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {filtered.map((a) => (
            <UnmatchedArtistRow key={a.id} artist={a} />
          ))}
        </ul>
      )}
    </>
  )
}
