'use client'

import { useMemo, useState } from 'react'
import { inputClass } from '../adminUi'

type Row = { id: string; genreId: string; genreName: string; artistName: string; albumTitle: string | null; note: string | null }

export default function GenreHighlightListClient({
  rows,
  deleteAction,
}: {
  rows: Row[]
  deleteAction: (formData: FormData) => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (q ? rows.filter((r) => r.artistName.toLowerCase().includes(q) || r.genreName.toLowerCase().includes(q)) : rows),
    [rows, q]
  )

  return (
    <div className="mt-4">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="アーティスト名・ジャンル名で絞り込み..."
        className={`${inputClass} max-w-xs`}
      />
      <p className="mt-2 text-xs text-white/40">{filtered.length}件</p>
      <ul className="mt-1 max-h-[50vh] space-y-1 overflow-y-auto text-sm text-white/60">
        {filtered.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-2">
            <span>
              {row.genreName} — {row.artistName}
              {row.albumTitle ? `「${row.albumTitle}」` : ''}
              {row.note ? `(${row.note})` : ''}
            </span>
            <form action={deleteAction}>
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="genre_id" value={row.genreId} />
              <button type="submit" className="shrink-0 text-xs text-white/40 hover:text-red-400">
                削除
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  )
}
