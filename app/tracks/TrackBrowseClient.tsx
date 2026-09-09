'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { formatDuration } from '@/utils/format'

type Track = {
  id: string
  title: string
  duration_seconds: number | null
  ranked: boolean
  onAir: boolean
}

type ArtistGroup = {
  id: string
  name: string
  image_url: string | null
  tracks: Track[]
}

const SEARCH_DEBOUNCE_MS = 300

/** 絞り込み・ページングはURLのクエリパラメータで表す(サーバー側でDBを絞るため)。 */
export default function TrackBrowseClient({
  groups,
  query,
  page,
  pageSize,
  totalCount,
  resultsCapped = false,
  tracksPerArtist = 30,
}: {
  groups: ArtistGroup[]
  query: string
  page: number
  pageSize: number
  totalCount: number
  resultsCapped?: boolean
  tracksPerArtist?: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  const [inputValue, setInputValue] = useState(query)
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    const timer = setTimeout(() => {
      if (inputValue.trim() === query) return
      navigate({ q: inputValue.trim() || null, page: null })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue, query])

  function navigate(changes: Record<string, string | null>) {
    const params = new URLSearchParams()
    const base: Record<string, string | null> = {
      q: query || null,
      page: page > 0 ? String(page) : null,
      ...changes,
    }
    for (const [key, value] of Object.entries(base)) {
      if (value) params.set(key, value)
    }
    const search = params.toString()
    startTransition(() => {
      router.push(search ? `${pathname}?${search}` : pathname)
    })
  }

  const filtered = groups
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const rangeStart = totalCount === 0 ? 0 : page * pageSize + 1
  const rangeEnd = Math.min((page + 1) * pageSize, totalCount)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">トラック</h1>
      <p className="mt-2 text-xs text-white/40">
        アーティストごとに、ランキング掲載・オンエア実績のある曲(🏆/📻)を先頭にして並べています。
      </p>

      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder="曲名・アーティスト名で絞り込み..."
        className="mt-6 w-full max-w-md rounded-md border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
        autoFocus
      />

      <p className={`mt-3 text-xs ${isPending ? 'text-white/25' : 'text-white/40'}`}>
        {totalCount}組のアーティスト{totalCount > 0 && `(${rangeStart}〜${rangeEnd}組目を表示)`}
        <span className="ml-2 text-white/30">各アーティスト最大{tracksPerArtist}曲</span>
      </p>
      {resultsCapped && (
        <p className="mt-1 text-xs text-amber-300/60">
          該当する曲が非常に多いため、検索結果の一部のみを表示しています。語を増やすと絞り込めます。
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">該当する曲が見つかりませんでした。</p>
      ) : (
        <div className="mt-6 space-y-8">
          {filtered.map((group) => (
            <section key={group.id}>
              <Link href={`/artists/${group.id}`} className="flex items-center gap-2 hover:opacity-70">
                {group.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={group.image_url} alt="" className="h-6 w-6 rounded-full object-cover" />
                ) : (
                  <div className="h-6 w-6 rounded-full bg-white/5" />
                )}
                <h2 className="text-sm font-semibold">{group.name}</h2>
              </Link>
              <ul className="mt-2 divide-y divide-white/10 border-t border-white/10">
                {group.tracks.map((track) => (
                  <li key={track.id}>
                    <Link
                      href={`/tracks/${track.id}`}
                      className="flex items-center justify-between gap-3 py-2 text-sm transition hover:opacity-70"
                    >
                      <span>
                        {(track.ranked || track.onAir) && (
                          <span className="mr-1.5">
                            {track.ranked && '🏆'}
                            {track.onAir && '📻'}
                          </span>
                        )}
                        {track.title}
                      </span>
                      <span className="shrink-0 text-xs text-white/30">{formatDuration(track.duration_seconds)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-4 text-xs text-white/50">
          <button
            type="button"
            onClick={() => navigate({ page: page - 1 > 0 ? String(page - 1) : null })}
            disabled={page === 0}
            className="rounded border border-white/15 px-3 py-1.5 transition hover:border-white/30 hover:text-white disabled:opacity-30 disabled:hover:border-white/15"
          >
            ← 前へ
          </button>
          <span>
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => navigate({ page: String(page + 1) })}
            disabled={page + 1 >= totalPages}
            className="rounded border border-white/15 px-3 py-1.5 transition hover:border-white/30 hover:text-white disabled:opacity-30 disabled:hover:border-white/15"
          >
            次へ →
          </button>
        </div>
      )}
    </div>
  )
}
