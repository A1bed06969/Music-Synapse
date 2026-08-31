'use client'

import { useState, useTransition } from 'react'
import SearchableSelect from '../../SearchableSelect'
import {
  searchAppleMusicTracksForPick,
  searchAppleMusicAlbumsForPick,
  setPickCandidateFromSearch,
  setAlbumCandidateFromSearch,
  setPickCandidateFromUrl,
  type PickerItem,
} from './actions'

export default function RadioPickMatcher({ pickId, albumMode = false }: { pickId: string; albumMode?: boolean }) {
  const [saved, setSaved] = useState<PickerItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState('')
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

  function submitUrl() {
    if (!url.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await setPickCandidateFromUrl(pickId, url.trim(), albumMode)
      if (result.success) {
        setSaved(result.item ?? { id: '', label: '設定しました' })
      } else {
        setError(result.message)
      }
    })
  }

  return (
    <div>
      <SearchableSelect
        searchAction={albumMode ? searchAppleMusicAlbumsForPick : searchAppleMusicTracksForPick}
        name={`candidate_${pickId}`}
        placeholder={albumMode ? 'Apple Musicでアルバムを検索...' : 'Apple Musicでトラックを検索...'}
        onSelect={(item) => {
          if (!item) return
          setError(null)
          startTransition(async () => {
            const result = albumMode
              ? await setAlbumCandidateFromSearch(pickId, item.id)
              : await setPickCandidateFromSearch(pickId, item.id)
            if (result.success) {
              setSaved(item)
            } else {
              setError(result.message)
            }
          })
        }}
      />

      {/* 検索で見つからない場合(表記ゆれ・無名アーティストが同名の有名曲に
       * 検索順位で負ける等)の手動フォールバック */}
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="shrink-0 text-[11px] text-white/30">またはURLで指定:</span>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submitUrl()
            }
          }}
          placeholder="https://music.apple.com/jp/album/..."
          className="w-full min-w-0 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none"
        />
        <button
          type="button"
          onClick={submitUrl}
          disabled={isPending || !url.trim()}
          className="shrink-0 rounded border border-white/15 px-2 py-1 text-[11px] hover:bg-white/5 disabled:opacity-40"
        >
          設定
        </button>
      </div>

      {isPending && <p className="mt-1 text-xs text-white/40">保存中...</p>}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  )
}
