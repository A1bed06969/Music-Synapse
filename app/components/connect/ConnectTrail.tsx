'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type Step = { id: string; name: string }
const KEY = 'connect-trail'
const MAX = 8

/** 相関図をたどった順(パンくず)。このタブの中だけで覚えておく。戻ったアーティストがあれば、そこから先を切る */
export default function ConnectTrail({ current }: { current: Step }) {
  const [trail, setTrail] = useState<Step[]>([current])

  useEffect(() => {
    let saved: Step[] = []
    try {
      saved = JSON.parse(sessionStorage.getItem(KEY) ?? '[]')
    } catch {}
    const at = saved.findIndex((s) => s.id === current.id)
    const next = (at >= 0 ? saved.slice(0, at + 1) : [...saved, current]).slice(-MAX)
    setTrail(next)
    try {
      sessionStorage.setItem(KEY, JSON.stringify(next))
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.id, current.name])

  if (trail.length <= 1) return null
  return (
    <nav aria-label="たどったアーティスト" className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-xs">
      {trail.map((s, i) => {
        const last = i === trail.length - 1
        return (
          <span key={s.id} className="inline-flex items-center gap-1.5">
            {last ? (
              <span className="rounded-full bg-[#b6f23a] px-3 py-1 font-bold text-black" aria-current="page">
                {s.name}
              </span>
            ) : (
              <Link href={`/relations/${s.id}`} className="rounded-full border border-white/15 px-3 py-1 text-white/70 hover:border-white/40 hover:text-white">
                {s.name}
              </Link>
            )}
            {!last && <span className="text-white/30">→</span>}
          </span>
        )
      })}
    </nav>
  )
}
