'use client'

import { useState, useTransition } from 'react'
import { searchMusicBrainzLabel, createLabelFromMusicBrainz } from './actions'
import type { MusicBrainzLabelSearchResult } from '@/utils/musicbrainz'

export default function MusicBrainzLabelSearch() {
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<MusicBrainzLabelSearchResult[] | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSearch() {
    if (!query.trim()) return
    startTransition(async () => {
      const results = await searchMusicBrainzLabel(query.trim())
      setCandidates(results)
    })
  }

  return (
    <div className="mt-6 rounded-md border border-white/15 p-4">
      <p className="text-xs text-white/40">MusicBrainzでレーベルを検索</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="レーベル名"
          className="w-full max-w-xs rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={isPending}
          className="rounded-md border border-white/15 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
        >
          {isPending ? '検索中...' : '検索'}
        </button>
      </div>

      {candidates !== null && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {candidates.length === 0 ? (
            <li className="text-white/40">候補が見つかりませんでした。</li>
          ) : (
            candidates.map((c) => (
              <li key={c.mbid} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {c.name}
                  <span className="ml-2 text-xs text-white/30">
                    {[c.type, c.areaName ?? c.country, c.foundedYear ? `${c.foundedYear}年設立` : null]
                      .filter(Boolean)
                      .join(' / ')}
                  </span>
                </span>
                <form action={createLabelFromMusicBrainz}>
                  <input type="hidden" name="mbid" value={c.mbid} />
                  <input type="hidden" name="name" value={c.name} />
                  <input type="hidden" name="founded_year" value={c.foundedYear ?? ''} />
                  <button
                    type="submit"
                    className="rounded-md border border-white/15 px-2 py-1 text-xs hover:bg-white/5"
                  >
                    この候補で登録
                  </button>
                </form>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
