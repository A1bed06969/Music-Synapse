'use client'

import { useState, useTransition } from 'react'
import SearchableSelect from '../../SearchableSelect'
import { searchAppleMusicTracksForPick, setPickCandidateFromSearch, type PickerItem } from './actions'

export default function RadioPickMatcher({ pickId }: { pickId: string }) {
  const [saved, setSaved] = useState<PickerItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (saved) {
    return (
      <div className="flex items-center gap-2 text-xs text-emerald-400">
        {saved.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={saved.imageUrl} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
        )}
        <span className="truncate">保存しました: {saved.label}</span>
      </div>
    )
  }

  return (
    <div>
      <SearchableSelect
        searchAction={searchAppleMusicTracksForPick}
        name={`candidate_${pickId}`}
        placeholder="Apple Musicでトラックを検索..."
        onSelect={(item) => {
          if (!item) return
          setError(null)
          startTransition(async () => {
            const result = await setPickCandidateFromSearch(pickId, item.id)
            if (result.success) {
              setSaved(item)
            } else {
              setError(result.message)
            }
          })
        }}
      />
      {isPending && <p className="mt-1 text-xs text-white/40">保存中...</p>}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  )
}
