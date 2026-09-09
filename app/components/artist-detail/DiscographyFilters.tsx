'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import type { DiscographyType, DiscographyCounts } from '@/utils/discographyCategories'

const ALBUM_FAMILY_BUTTONS: { value: DiscographyType; label: string }[] = [
  { value: 'Album', label: 'スタジオアルバム' },
  { value: 'Live', label: 'ライブアルバム' },
  { value: 'Remix', label: 'リミックスアルバム' },
  { value: 'Best', label: 'ベストアルバム' },
  { value: 'Omnibus', label: 'オムニバス' },
]

const SINGLE_FAMILY_BUTTONS: { value: DiscographyType; label: string }[] = [
  { value: 'Single', label: 'シングル' },
  { value: 'EP', label: 'EP' },
]

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'streaming', label: '配信中' },
  { value: 'unreleased', label: '未解禁' },
]

/** Discographyセクション上部のフィルター。ALL/ALBUM/SINGLE・EPの大分類→
 * 選択した大分類配下の具体的な種別、という2段構成。URLのクエリパラメータ
 * (category/type/status)で状態を表す。そのアーティストが1件も持たない
 * 種別・大分類のボタンは、countsを見て最初から出さない。 */
export default function DiscographyFilters({
  category,
  type,
  status,
  counts,
}: {
  category: 'all' | 'album' | 'single'
  type: string
  status: string
  counts: DiscographyCounts
}) {
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

  const subButtons =
    category === 'album'
      ? ALBUM_FAMILY_BUTTONS.filter((b) => counts[b.value] > 0)
      : category === 'single'
        ? SINGLE_FAMILY_BUTTONS.filter((b) => counts[b.value] > 0)
        : []

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5 overflow-x-auto">
        <button
          type="button"
          onClick={() => navigate({ category: null, type: null })}
          className={`shrink-0 rounded-full border px-3 py-1 text-xs ${category === 'all' ? 'border-white bg-white text-black' : 'border-white/15 text-white/60'}`}
        >
          ALL
        </button>
        {counts.albumFamily > 0 && (
          <button
            type="button"
            onClick={() => navigate({ category: 'album', type: null })}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs ${category === 'album' ? 'border-white bg-white text-black' : 'border-white/15 text-white/60'}`}
          >
            ALBUM
          </button>
        )}
        {counts.singleFamily > 0 && (
          <button
            type="button"
            onClick={() => navigate({ category: 'single', type: null })}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs ${category === 'single' ? 'border-white bg-white text-black' : 'border-white/15 text-white/60'}`}
          >
            SINGLE・EP
          </button>
        )}
      </div>

      {subButtons.length > 0 && (
        <div className="flex flex-wrap gap-1.5 overflow-x-auto">
          {subButtons.map((b) => (
            <button
              key={b.value}
              type="button"
              onClick={() => navigate({ type: b.value })}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs ${type === b.value ? 'border-white bg-white text-black' : 'border-white/15 text-white/60'}`}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}

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
