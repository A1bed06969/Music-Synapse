'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { inputClass } from '../adminUi'

type Row = {
  id: number
  displayName: string
  eventName: string
  year: number | null
  stage: string | null
  venue: string | null
  isHeadliner: boolean
}

export default function EventAppearanceListClient({ rows }: { rows: Row[] }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (q ? rows.filter((r) => r.displayName.toLowerCase().includes(q) || r.eventName.toLowerCase().includes(q)) : rows),
    [rows, q]
  )

  return (
    <div className="mt-4">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="アーティスト名・イベント名で絞り込み..."
        className={`${inputClass} max-w-xs`}
      />
      <p className="mt-2 text-xs text-white/40">{filtered.length}件</p>
      <ul className="mt-1 max-h-[60vh] space-y-1 overflow-y-auto text-sm text-white/60">
        {filtered.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-2">
            <span>
              {row.displayName} — {row.eventName}
              {row.year ? `(${row.year})` : ''}
              {row.stage ? ` / ${row.stage}` : ''}
              {row.venue ? ` @ ${row.venue}` : ''}
              {row.isHeadliner && <span className="text-white/30"> ★ヘッドライナー</span>}
            </span>
            <Link href={`/admin/data/events/appearance/${row.id}/edit`} className="shrink-0 text-xs text-white/40 hover:text-white/70">
              編集 →
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
