'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { searchAppleMusicArtist, importAndRegisterFestivalArtist, type ItunesArtistSearchResultWithImage } from './actions'

type PickInput = {
  artistName: string
  datasetKey: string
  festivalName: string
  editionYear: number
  startDate: string | null
  endDate: string | null
  stage: string | null
  performanceDate: string | null
  startAt: string | null
  endAt: string | null
  day: string | null
  region?: string | null
  suspicious?: boolean
}

export default function UnmatchedArtistTag({ pick }: { pick: PickInput }) {
  const [expanded, setExpanded] = useState(false)
  const [candidates, setCandidates] = useState<ItunesArtistSearchResultWithImage[] | null>(null)
  const [registered, setRegistered] = useState<{ artistId: string; registeredName: string } | null>(null)
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

  function handleRegister(candidate: ItunesArtistSearchResultWithImage) {
    setErrorMessage(null)
    setRegisteringId(candidate.artistId)
    startTransition(async () => {
      const result = await importAndRegisterFestivalArtist({
        appleMusicArtistId: candidate.artistId,
        pickArtistName: pick.artistName,
        datasetKey: pick.datasetKey,
        festivalName: pick.festivalName,
        editionYear: pick.editionYear,
        startDate: pick.startDate,
        endDate: pick.endDate,
        stage: pick.stage,
        performanceDate: pick.performanceDate,
        startAt: pick.startAt,
        endAt: pick.endAt,
        region: pick.region,
      })
      setRegisteringId(null)
      if (result.success) {
        setRegistered({ artistId: result.artistId, registeredName: result.registeredName })
      } else {
        setErrorMessage(result.message)
      }
    })
  }

  if (registered) {
    // iTunesの検索結果はアーティスト名がローカライズされていることがあり
    // (例:「LOYLE CARNER」→「ロイル・カーナー」)、その場合フェス側の表記とは
    // 一致しなくなる。この行の一覧上の表示は登録済みにならず一見不具合に見えるが、
    // 実際には正しく登録されている(実際にこれで「登録したのに反映されない」と
    // 誤解された不具合があったため、実際に登録された名前とリンクを必ず示す)
    const renamed = registered.registeredName.trim() !== pick.artistName.trim()
    return (
      <span className="rounded-full border border-green-500/30 bg-green-500/5 px-2 py-0.5 text-xs text-green-400">
        ✓{' '}
        <Link href={`/artists/${registered.artistId}`} className="hover:underline">
          {pick.artistName}
        </Link>
        {renamed && <span className="text-green-400/70"> (「{registered.registeredName}」として登録)</span>}
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
          pick.suspicious
            ? expanded
              ? 'border-amber-400/60 text-amber-300'
              : 'border-amber-400/30 text-amber-400/60 hover:border-amber-400/60 hover:text-amber-300'
            : expanded
              ? 'border-white/30 text-white/70'
              : 'border-white/5 text-white/25 hover:border-white/20 hover:text-white/50'
        }`}
      >
        {pick.suspicious && '⚠ '}
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
                <span className="flex items-center gap-2">
                  {c.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.imageUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] text-white/30">
                      ?
                    </span>
                  )}
                  <span>
                    {c.artistName}
                    {c.primaryGenreName && <span className="ml-1 text-white/30">({c.primaryGenreName})</span>}
                  </span>
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
