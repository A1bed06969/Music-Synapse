'use client'

import { useMemo, useState } from 'react'
import { inputClass } from '../adminUi'

export default function ArtistGenreListClient({ rows }: { rows: { artistName: string; genreName: string }[] }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (q ? rows.filter((r) => r.artistName.toLowerCase().includes(q) || r.genreName.toLowerCase().includes(q)) : rows),
    [rows, q]
  )

  return (
    <div className="mt-3">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="アーティスト名・ジャンル名で絞り込み..."
        className={`${inputClass} max-w-xs`}
      />
      <p className="mt-2 text-xs text-white/40">{filtered.length}件</p>
      <ul className="mt-1 max-h-[50vh] space-y-1 overflow-y-auto text-sm text-white/60">
        {filtered.map((r, i) => (
          <li key={i}>
            {r.artistName} — {r.genreName}
          </li>
        ))}
      </ul>
    </div>
  )
}
