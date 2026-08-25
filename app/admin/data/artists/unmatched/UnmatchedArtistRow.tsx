'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import {
  searchAppleMusicArtistForStub,
  linkStubArtistToItunes,
  type ItunesArtistSearchResultWithImage,
} from './actions'

type StubArtist = {
  id: string
  name: string
  createdAt: string
  appearanceContext: string[]
}

export default function UnmatchedArtistRow({ artist }: { artist: StubArtist }) {
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState(artist.name)
  const [candidates, setCandidates] = useState<ItunesArtistSearchResultWithImage[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [linkingId, setLinkingId] = useState<number | null>(null)
  const [linked, setLinked] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSearch() {
    if (!query.trim()) return
    setSearching(true)
    setErrorMessage(null)
    startTransition(async () => {
      const results = await searchAppleMusicArtistForStub(query.trim())
      setCandidates(results)
      setSearching(false)
    })
  }

  function handleToggle() {
    const next = !expanded
    setExpanded(next)
    if (next && candidates === null) handleSearch()
  }

  function handleLink(candidate: ItunesArtistSearchResultWithImage) {
    setErrorMessage(null)
    setLinkingId(candidate.artistId)
    startTransition(async () => {
      const result = await linkStubArtistToItunes(artist.id, candidate.artistId)
      setLinkingId(null)
      if (result.success) {
        setLinked(result.registeredName)
      } else {
        setErrorMessage(result.message)
      }
    })
  }

  if (linked) {
    const renamed = linked.trim() !== artist.name.trim()
    return (
      <li className="flex items-center justify-between gap-2 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">
        <span>
          ✓{' '}
          <Link href={`/artists/${artist.id}`} className="hover:underline">
            {artist.name}
          </Link>
          {renamed && <span className="text-green-400/70"> (「{linked}」として紐付け)</span>}
        </span>
      </li>
    )
  }

  return (
    <li className="rounded-md border border-white/10 bg-white/[0.02] px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href={`/artists/${artist.id}`} className="font-medium hover:underline">
            {artist.name}
          </Link>
          {artist.appearanceContext.length > 0 && (
            <p className="mt-0.5 text-xs text-white/40">{artist.appearanceContext.join(' / ')}</p>
          )}
        </div>
        <button
          type="button"
          onClick={handleToggle}
          className="rounded border border-white/15 px-2.5 py-1 text-xs hover:bg-white/5"
        >
          {expanded ? '閉じる' : 'Apple Musicで検索 →'}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-white/10 bg-[#111] p-2.5 text-xs">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSearch()
                }
              }}
              className="min-w-0 flex-1 rounded border border-white/15 bg-transparent px-2 py-1 text-xs text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleSearch}
              disabled={isPending}
              className="shrink-0 rounded border border-white/15 px-2 py-1 hover:bg-white/5 disabled:opacity-40"
            >
              検索
            </button>
          </div>

          {searching ? (
            <span className="text-white/40">検索中...</span>
          ) : candidates && candidates.length === 0 ? (
            <span className="text-white/40">候補が見つかりませんでした。別のキーワードで試してください。</span>
          ) : candidates && candidates.length > 0 ? (
            <div className="flex flex-col gap-1">
              {candidates.map((c) => (
                <div key={c.artistId} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
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
                  </div>
                  <button
                    type="button"
                    onClick={() => handleLink(c)}
                    disabled={isPending}
                    className="shrink-0 rounded border border-white/15 px-2 py-0.5 hover:bg-white/5 disabled:opacity-40"
                  >
                    {isPending && linkingId === c.artistId ? '紐付け中...' : 'この人で紐付け'}
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {errorMessage && <span className="text-red-400">{errorMessage}</span>}
        </div>
      )}
    </li>
  )
}
