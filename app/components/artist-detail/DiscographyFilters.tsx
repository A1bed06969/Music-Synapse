'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { ALBUM_TYPE_LABEL_JA, ALBUM_TYPE_ORDER } from '@/utils/albumType'

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'streaming', label: '配信中' },
  { value: 'unreleased', label: '未解禁' },
]

/** Discographyセクション上部のフィルター。URLのクエリパラメータ(type/status)で
 * 状態を表す(既存/albumsページと同じ、サーバー側で絞り込むための設計)。 */
export default function DiscographyFilters({ type, status }: { type: string; status: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function navigate(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value && value !== 'all') params.set(key, value)
      else params.delete(key)
    }
    params.delete('page')
    const search = params.toString()
    router.push(search ? `${pathname}?${search}` : pathname)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5 overflow-x-auto">
        <button
          type="button"
          onClick={() => navigate({ type: null })}
          className={`shrink-0 rounded-full border px-3 py-1 text-xs ${type === 'all' ? 'border-white bg-white text-black' : 'border-white/15 text-white/60'}`}
        >
          ALL
        </button>
        {ALBUM_TYPE_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => navigate({ type: t })}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs ${type === t ? 'border-white bg-white text-black' : 'border-white/15 text-white/60'}`}
          >
            {ALBUM_TYPE_LABEL_JA[t]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => navigate({ status: f.value })}
            className={`rounded-full border px-3 py-1 text-xs ${status === f.value ? 'border-white bg-white text-black' : 'border-white/15 text-white/60'}`}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  )
}
