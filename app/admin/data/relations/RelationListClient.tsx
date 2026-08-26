'use client'

import { useMemo, useState } from 'react'
import { inputClass } from '../adminUi'

type Row = {
  id: number
  artistAName: string
  artistBName: string
  dotted: boolean
  relationType: string
  description: string | null
}

export default function RelationListClient({ rows }: { rows: Row[] }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (q ? rows.filter((r) => r.artistAName.toLowerCase().includes(q) || r.artistBName.toLowerCase().includes(q)) : rows),
    [rows, q]
  )

  return (
    <div className="mt-4">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="アーティスト名で絞り込み..."
        className={`${inputClass} max-w-xs`}
      />
      <p className="mt-2 text-xs text-white/40">{filtered.length}件</p>
      <ul className="mt-1 max-h-[50vh] space-y-1 overflow-y-auto text-sm text-white/60">
        {filtered.map((row) => (
          <li key={row.id}>
            {row.artistAName} {row.dotted ? '┄' : '─'} {row.artistBName}
            <span className="text-white/30">
              {' '}
              ({row.relationType}
              {row.description ? `: ${row.description}` : ''})
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
