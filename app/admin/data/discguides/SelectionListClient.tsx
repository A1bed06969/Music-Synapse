'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { inputClass } from '../adminUi'

type Row = { id: string; guideTitle: string; albumTitle: string; note: string | null }

export default function SelectionListClient({ rows }: { rows: Row[] }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (q ? rows.filter((r) => r.guideTitle.toLowerCase().includes(q) || r.albumTitle.toLowerCase().includes(q)) : rows),
    [rows, q]
  )

  return (
    <div className="mt-4">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="書籍名・アルバム名で絞り込み..."
        className={`${inputClass} max-w-xs`}
      />
      <p className="mt-2 text-xs text-white/40">{filtered.length}件</p>
      <ul className="mt-1 max-h-[60vh] space-y-1 overflow-y-auto text-sm text-white/60">
        {filtered.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-2">
            <span>
              {row.guideTitle} — {row.albumTitle}
              {row.note ? `(${row.note})` : ''}
            </span>
            <Link
              href={`/admin/data/discguides/selection/${row.id}/edit`}
              className="shrink-0 text-xs text-white/40 hover:text-white/70"
            >
              編集 →
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
