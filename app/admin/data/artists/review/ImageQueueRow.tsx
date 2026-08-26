'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { searchAppleMusicArtist, type ItunesArtistSearchResultWithImage } from '../../events/festival-pilot/actions'
import { confirmArtistAppleMusicId, skipImageMatch } from './actions'

export default function ImageQueueRow({ artistId, name }: { artistId: string; name: string }) {
  const [expanded, setExpanded] = useState(false)
  const [candidates, setCandidates] = useState<ItunesArtistSearchResultWithImage[] | null>(null)
  const [done, setDone] = useState<'confirmed' | 'skipped' | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | 'skip' | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleToggle() {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (candidates !== null) return
    startTransition(async () => {
      const results = await searchAppleMusicArtist(name)
      setCandidates(results)
    })
  }

  function handleConfirm(candidate: ItunesArtistSearchResultWithImage) {
    setErrorMessage(null)
    setBusyId(candidate.artistId)
    startTransition(async () => {
      const result = await confirmArtistAppleMusicId(artistId, candidate.artistId)
      setBusyId(null)
      if (result.success) {
        setDone('confirmed')
      } else {
        setErrorMessage(result.message ?? '確定に失敗しました。')
      }
    })
  }

  function handleSkip() {
    setBusyId('skip')
    startTransition(async () => {
      await skipImageMatch(artistId)
      setBusyId(null)
      setDone('skipped')
    })
  }

  if (done) {
    return (
      <li className="flex items-center justify-between gap-2 rounded-md border border-white/10 px-4 py-3 text-sm text-white/40">
        <span>{name}</span>
        <span className={done === 'confirmed' ? 'text-green-400' : 'text-white/30'}>
          {done === 'confirmed' ? '✓ 確定しました' : 'スキップしました'}
        </span>
      </li>
    )
  }

  return (
    <li className="rounded-md border border-white/15 px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/admin/data/artists/${artistId}/edit`} className="font-medium hover:underline">
          {name}
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleSkip}
            disabled={isPending}
            className="text-xs text-white/30 hover:text-white/60 disabled:opacity-40"
          >
            {isPending && busyId === 'skip' ? '処理中...' : '該当なし'}
          </button>
          <button
            type="button"
            onClick={handleToggle}
            className="rounded-md border border-white/15 px-3 py-1 text-xs hover:bg-white/5"
          >
            {expanded ? '閉じる' : 'Apple Musicで検索'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3">
          {candidates === null ? (
            <p className="text-xs text-white/40">検索中...</p>
          ) : candidates.length === 0 ? (
            <p className="text-xs text-white/40">候補が見つかりませんでした。</p>
          ) : (
            candidates.map((c) => (
              <div key={c.artistId} className="flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  {c.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] text-white/30">
                      ?
                    </span>
                  )}
                  <span>
                    {c.artistName}
                    {c.primaryGenreName && <span className="ml-1 text-white/30">({c.primaryGenreName})</span>}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleConfirm(c)}
                  disabled={isPending}
                  className="shrink-0 rounded border border-white/15 px-2 py-1 hover:bg-white/5 disabled:opacity-40"
                >
                  {isPending && busyId === c.artistId ? '確定中...' : 'この人で確定'}
                </button>
              </div>
            ))
          )}
          {errorMessage && <p className="text-xs text-red-400">{errorMessage}</p>}
        </div>
      )}
    </li>
  )
}
