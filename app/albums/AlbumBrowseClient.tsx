'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { formatDate, STREAMING_STATUS_LABEL } from '@/utils/format'

type Album = {
  id: string
  title: string
  title_kana: string | null
  jacket_url: string | null
  releaseDate: string | null
  streamingStatus: string | null
  artistName: string | null
}

type SortMode = 'kana' | 'release'
type StatusFilter = 'all' | 'streaming' | 'unreleased'

// album.streaming_statusは'all'/'apple_only'/'none'/'unreleased'/nullを取りうるが、
// 実データでは'all'/'apple_only'はほぼ使われておらず(通常の配信中アルバムは
// 明示的にタグ付けせずnullのまま)、'none'(配信終了・非公開等)と'unreleased'
// (権利者都合で元々非解禁)だけが特別扱いされる。この判定はDB側の
// browse_albums(supabase/migrations/20260909_add_album_track_browse.sql)でも同じ。
const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'streaming', label: `${STREAMING_STATUS_LABEL.all.icon} 配信中` },
  { value: 'unreleased', label: `${STREAMING_STATUS_LABEL.none.icon} 未解禁` },
]

const SEARCH_DEBOUNCE_MS = 300

/** 絞り込み・並び替え・ページングはすべてURLのクエリパラメータで表す
 * (サーバー側でDBを絞るため)。共有URLや戻る/進むでも同じ結果が再現できる。 */
export default function AlbumBrowseClient({
  albums,
  sort,
  status,
  query,
  page,
  pageSize,
  totalCount,
}: {
  albums: Album[]
  sort: SortMode
  status: StatusFilter
  query: string
  page: number
  pageSize: number
  totalCount: number
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
      sort: sort === 'kana' ? null : sort,
      status: status === 'all' ? null : status,
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

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const rangeStart = totalCount === 0 ? 0 : page * pageSize + 1
  const rangeEnd = Math.min((page + 1) * pageSize, totalCount)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">アルバム</h1>
        <div className="flex items-center gap-3">
          <Link href="/albums/calendar" className="text-xs text-white/50 transition hover:text-white">
            🗓️ カレンダーで見る
          </Link>
          <div className="flex gap-1 rounded-md border border-white/15 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => navigate({ sort: null, page: null })}
              className={`rounded px-3 py-1 ${sort === 'kana' ? 'bg-white text-black' : 'text-white/60 hover:text-white'}`}
            >
              50音順
            </button>
            <button
              type="button"
              onClick={() => navigate({ sort: 'release', page: null })}
              className={`rounded px-3 py-1 ${sort === 'release' ? 'bg-white text-black' : 'text-white/60 hover:text-white'}`}
            >
              発売日順
            </button>
          </div>
        </div>
      </div>

      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder="アルバム名・アーティスト名で絞り込み..."
        className="mt-6 w-full max-w-md rounded-md border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
        autoFocus
      />

      <div className="mt-3 flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => navigate({ status: f.value === 'all' ? null : f.value, page: null })}
            className={`rounded-full border px-3 py-1 text-xs ${
              status === f.value
                ? 'border-white bg-white text-black'
                : 'border-white/15 text-white/60 hover:border-white/30'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <p className={`mt-3 text-xs ${isPending ? 'text-white/25' : 'text-white/40'}`}>
        {totalCount}件{totalCount > 0 && `(${rangeStart}〜${rangeEnd}件目を表示)`}
      </p>

      {albums.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">該当するアルバムが見つかりませんでした。</p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {albums.map((album) => {
            const statusLabel = album.streamingStatus ? STREAMING_STATUS_LABEL[album.streamingStatus] : null
            return (
              <Link key={album.id} href={`/albums/${album.id}`} className="group block">
                <div className="aspect-square overflow-hidden rounded-md bg-white/5">
                  {album.jacket_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={album.jacket_url}
                      alt={album.title}
                      loading="lazy"
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-white/20">No Art</div>
                  )}
                </div>
                <p className="mt-2 truncate text-xs font-medium">{album.title}</p>
                {album.artistName && <p className="truncate text-xs text-white/40">{album.artistName}</p>}
                {sort === 'release' && (
                  <p className="truncate text-xs text-white/30">
                    {formatDate(album.releaseDate)}
                    {statusLabel ? ` · ${statusLabel.icon}` : ''}
                  </p>
                )}
              </Link>
            )
          })}
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
