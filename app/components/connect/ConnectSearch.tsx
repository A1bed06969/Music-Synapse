'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { search, type SearchArtist } from '@/app/search/actions'

/** Connect の相関図を見たいアーティストを探す検索欄。候補を押すと、その人の相関図(/relations/[id])へ */
export default function ConnectSearch({ autoFocus = false }: { autoFocus?: boolean }) {
  const [query, setQuery] = useState('')
  const [artists, setArtists] = useState<SearchArtist[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputId = useId()

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const q = query.trim()
    if (!q) {
      setArtists([])
      return
    }
    timer.current = setTimeout(async () => {
      setLoading(true)
      const r = await search(q)
      setArtists((r.artists ?? []).slice(0, 10))
      setLoading(false)
      setOpen(true)
    }, 300)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [query])

  // 欄の外を押したら候補を閉じる
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={inputId} className="sr-only">
        アーティストを検索
      </label>
      <input
        id={inputId}
        type="search"
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => artists.length && setOpen(true)}
        placeholder="つながりを見たいアーティストを検索…"
        autoComplete="off"
        className="w-full rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm text-white placeholder:text-white/35 focus:border-[#b6f23a] focus:outline-none"
      />
      {open && query.trim() && (
        <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-white/15 bg-[#14160f] shadow-2xl">
          {loading && artists.length === 0 ? (
            <p className="px-4 py-3 text-sm text-white/40">検索しています…</p>
          ) : artists.length === 0 ? (
            <p className="px-4 py-3 text-sm text-white/40">見つかりませんでした。</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {artists.map((a) => (
                <li key={a.id}>
                  <Link href={`/relations/${a.id}`} onClick={() => setOpen(false)} className="block px-4 py-2.5 text-sm hover:bg-white/[0.06]">
                    <span className="font-bold">{a.name}</span>
                    {(a.name_kana || a.name_en) && <span className="ml-2 text-xs text-white/40">{a.name_en ?? a.name_kana}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
