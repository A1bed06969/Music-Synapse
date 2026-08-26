'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { inputClass } from './adminUi'

export default function AdminArtistSearchList({ artists }: { artists: { id: string; name: string }[] }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => (q ? artists.filter((a) => a.name.toLowerCase().includes(q)) : []), [artists, q])

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="アーティスト名で検索..."
        className={`${inputClass} max-w-sm`}
      />
      {q === '' ? (
        <p className="mt-4 text-sm text-white/40">アーティスト名を入力すると一覧が表示されます({artists.length}件登録済み)</p>
      ) : filtered.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">該当するアーティストが見つかりませんでした。</p>
      ) : (
        <>
          <p className="mt-4 text-xs text-white/40">{filtered.length}件</p>
          <ul className="mt-2 max-h-[60vh] divide-y divide-white/10 overflow-y-auto">
            {filtered.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                <span>{a.name}</span>
                <Link href={`/admin/data/artists/${a.id}/edit`} className="text-xs text-white/40 hover:text-white/70">
                  編集 →
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
