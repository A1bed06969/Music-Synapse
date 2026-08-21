'use client'

import { useState, useTransition } from 'react'
import { lookupWikipediaGenre, applyWikipediaGenreLookup } from './actions'
import type { WikipediaGenreInfo } from '@/utils/wikipediaGenre'

export default function WikipediaGenreSearch({ genreOptions }: { genreOptions: { id: string; name: string }[] }) {
  const [genreId, setGenreId] = useState('')
  const [query, setQuery] = useState('')
  const [info, setInfo] = useState<WikipediaGenreInfo | null | undefined>(undefined)
  const [isPending, startTransition] = useTransition()

  function handleSearch() {
    if (!query.trim()) return
    startTransition(async () => {
      const result = await lookupWikipediaGenre(query.trim())
      setInfo(result)
    })
  }

  return (
    <div className="mt-6 rounded-md border border-white/15 p-4">
      <p className="text-xs text-white/40">Wikipediaでジャンルの発祥・派生関係を検索</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <select
          value={genreId}
          onChange={(e) => setGenreId(e.target.value)}
          className="w-full max-w-xs rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
        >
          <option value="" disabled>
            反映先のジャンルを選択
          </option>
          {genreOptions.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Wikipedia記事名(例: Techno, シティ・ポップ)"
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

      {info === null && <p className="mt-3 text-sm text-white/40">Wikipediaにインフォボックスが見つかりませんでした。</p>}

      {info && (
        <form action={applyWikipediaGenreLookup} className="mt-3 space-y-2 text-sm">
          <input type="hidden" name="genre_id" value={genreId} />
          <input type="hidden" name="source_url" value={info.sourceUrl} />
          <p>
            出典:{' '}
            <a href={info.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:text-blue-200">
              {info.sourceUrl}
            </a>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-white/70">
              発祥年:
              <input
                type="number"
                name="origin_year"
                defaultValue={info.originYear ?? ''}
                className="w-24 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-1.5 text-white/70">
              発祥地:
              <input
                type="text"
                name="origin_place"
                defaultValue={info.originPlace ?? ''}
                className="w-56 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
          </div>
          {info.stylisticOrigins.length > 0 && (
            <div>
              <p className="text-white/50">起源ジャンル(不要なものはチェックを外す):</p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {info.stylisticOrigins.map((name, i) => (
                  <label key={`${name}-${i}`} className="flex items-center gap-1 text-white/70">
                    <input type="checkbox" name="stylistic_origins" value={name} defaultChecked />
                    {name}
                  </label>
                ))}
              </div>
            </div>
          )}
          {info.subgenres.length > 0 && (
            <div>
              <p className="text-white/50">サブジャンル(不要なものはチェックを外す):</p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {info.subgenres.map((name, i) => (
                  <label key={`${name}-${i}`} className="flex items-center gap-1 text-white/70">
                    <input type="checkbox" name="subgenres" value={name} defaultChecked />
                    {name}
                  </label>
                ))}
              </div>
            </div>
          )}
          {info.derivatives.length > 0 && (
            <div>
              <p className="text-white/50">派生ジャンル(不要なものはチェックを外す):</p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {info.derivatives.map((name, i) => (
                  <label key={`${name}-${i}`} className="flex items-center gap-1 text-white/70">
                    <input type="checkbox" name="derivatives" value={name} defaultChecked />
                    {name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <button
            type="submit"
            disabled={!genreId}
            className="rounded-md border border-white/15 px-3 py-1 text-xs hover:bg-white/5 disabled:opacity-40"
          >
            この内容で取込
          </button>
        </form>
      )}
    </div>
  )
}
