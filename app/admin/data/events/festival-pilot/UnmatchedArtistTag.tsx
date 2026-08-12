'use client'

import { useState, useTransition } from 'react'
import { searchAppleMusicArtist, importAndRegisterFestivalArtist } from './actions'
import type { ItunesArtistSearchResult } from '@/utils/itunes'

type PickInput = {
  artistName: string
  festivalName: string
  editionYear: number
  startDate: string | null
  endDate: string | null
  stage: string | null
  performanceDate: string | null
  startAt: string | null
  endAt: string | null
  day: string | null
}

export default function UnmatchedArtistTag({ pick }: { pick: PickInput }) {
  const [expanded, setExpanded] = useState(false)
  const [candidates, setCandidates] = useState<ItunesArtistSearchResult[] | null>(null)
  const [registeredMessage, setRegisteredMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [registeringId, setRegisteringId] = useState<number | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleToggle() {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (candidates !== null) return
    startTransition(async () => {
      const results = await searchAppleMusicArtist(pick.artistName)
      setCandidates(results)
    })
  }

  function handleRegister(candidate: ItunesArtistSearchResult) {
    setErrorMessage(null)
    setRegisteringId(candidate.artistId)
    startTransition(async () => {
      const result = await importAndRegisterFestivalArtist({
        appleMusicArtistId: candidate.artistId,
        festivalName: pick.festivalName,
        editionYear: pick.editionYear,
        startDate: pick.startDate,
        endDate: pick.endDate,
        stage: pick.stage,
        performanceDate: pick.performanceDate,
        startAt: pick.startAt,
        endAt: pick.endAt,
      })
      setRegisteringId(null)
      if (result.success) {
        setRegisteredMessage(result.message)
      } else {
        setErrorMessage(result.message)
      }
    })
  }

  if (registeredMessage) {
    return (
      <span className="rounded-full border border-green-500/30 bg-green-500/5 px-2 py-0.5 text-xs text-green-400">
        ✓ {pick.artistName}
      </span>
    )
  }

  return (
    <span className="inline-block align-top">
      <button
        type="button"
        onClick={handleToggle}
        title={pick.day ?? undefined}
        className={`rounded-full border px-2 py-0.5 text-xs transition ${
          expanded ? 'border-white/30 text-white/70' : 'border-white/5 text-white/25 hover:border-white/20 hover:text-white/50'
        }`}
      >
        {pick.artistName}
      </button>

      {expanded && (
        <span className="mt-1 flex flex-col gap-1 rounded-md border border-white/15 bg-[#111] p-2 text-xs">
          {candidates === null ? (
            <span className="text-white/40">Apple Musicを検索中...</span>
          ) : candidates.length === 0 ? (
            <span className="text-white/40">候補が見つかりませんでした。</span>
          ) : (
            candidates.map((c) => (
              <span key={c.artistId} className="flex items-center justify-between gap-3">
                <span>
                  {c.artistName}
                  {c.primaryGenreName && <span className="ml-1 text-white/30">({c.primaryGenreName})</span>}
                </span>
                <button
                  type="button"
                  onClick={() => handleRegister(c)}
                  disabled={isPending}
                  className="shrink-0 rounded border border-white/15 px-2 py-0.5 hover:bg-white/5 disabled:opacity-40"
                >
                  {isPending && registeringId === c.artistId ? '取込中...(最大1分程度)' : 'この人で登録'}
                </button>
              </span>
            ))
          )}
          {errorMessage && <span className="text-red-400">{errorMessage}</span>}
        </span>
      )}
    </span>
  )
}
