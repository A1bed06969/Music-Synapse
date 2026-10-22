'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { search, type SearchTrack } from '@/app/search/actions'

/** 解剖したい曲を探す検索欄。候補を押すと、その曲の解剖ページ(/sampling/[id])へ */
export default function TrackSearch() {
  const [query, setQuery] = useState('')
  const [tracks, setTracks] = useState<SearchTrack[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const inputId = useId()

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const q = query.trim()
    if (!q) {
      setTracks([])
      return
    }
    timer.current = setTimeout(async () => {
      setLoading(true)
      const r = await search(q)
      setTracks((r.tracks ?? []).slice(0, 10))
      setLoading(false)
      setOpen(true)
    }, 300)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [query])

  useEffect(() => {
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  return (
    <div ref={box} className="relative">
      <label htmlFor={inputId} className="sr-only">
        曲を検索
      </label>
      <input
        id={inputId}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => tracks.length && setOpen(true)}
        placeholder="解剖したい曲を検索…"
        autoComplete="off"
        className="w-full rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm text-white placeholder:text-white/35 focus:border-[#52e05f] focus:outline-none"
      />
      {open && query.trim() && (
        <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-white/15 bg-[#14160f] shadow-2xl">
          {loading && tracks.length === 0 ? (
            <p className="px-4 py-3 text-sm text-white/40">検索しています…</p>
          ) : tracks.length === 0 ? (
            <p className="px-4 py-3 text-sm text-white/40">見つかりませんでした。</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {tracks.map((t) => (
                <li key={t.id}>
                  <Link href={`/sampling/${t.id}`} onClick={() => setOpen(false)} className="block px-4 py-2.5 text-sm hover:bg-white/[0.06]">
                    <span className="font-bold">{t.title}</span>
                    {t.artist?.name && <span className="ml-2 text-xs text-white/45">{t.artist.name}</span>}
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
