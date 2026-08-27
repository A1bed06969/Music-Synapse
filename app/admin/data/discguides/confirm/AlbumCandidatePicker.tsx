'use client'

// ネイティブの<select>は<option>内に画像を置けないため、ジャケット候補を
// 見比べながら選べるようにするには自前のドロップダウンが必要になる。

import { useState } from 'react'

type Candidate = {
  id: string
  title: string
  artist_name: string
  similarity?: number
  artwork_url?: string
}

export default function AlbumCandidatePicker({
  candidates,
  value,
  onChange,
}: {
  candidates: Candidate[]
  value: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = candidates.find((c) => c.id === value)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-1 flex w-full items-center gap-2 rounded bg-white/5 px-2 py-1 text-left text-sm text-white"
      >
        {selected ? (
          <>
            {selected.artwork_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selected.artwork_url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
            )}
            <span className="min-w-0 flex-1 truncate">
              {selected.title} / {selected.artist_name}
              {selected.similarity !== undefined ? ` (一致度${Math.round(selected.similarity * 100)}%)` : ''}
            </span>
          </>
        ) : (
          <span className="flex-1 text-white/70">新規作成</span>
        )}
        <span className="shrink-0 text-white/30">▾</span>
      </button>

      {open && (
        <div className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-white/15 bg-black shadow-lg">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange('new')
              setOpen(false)
            }}
            className="block w-full px-3 py-2 text-left text-sm text-white hover:bg-white/10"
          >
            新規作成
          </button>
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(c.id)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white hover:bg-white/10"
            >
              {c.artwork_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.artwork_url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-white/10 text-[10px] text-white/30">
                  ?
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">
                {c.title} / {c.artist_name}
                {c.similarity !== undefined ? ` (一致度${Math.round(c.similarity * 100)}%)` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
