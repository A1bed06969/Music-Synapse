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
        <div className="mt-3 space-y-1.5 text-sm">
          <p>
            出典:{' '}
            <a href={info.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:text-blue-200">
              {info.sourceUrl}
            </a>
          </p>
          <p className="text-white/70">
            発祥: {info.originYear ?? '不明'}
            {info.originPlace ? ` / ${info.originPlace}` : ''}
          </p>
          {info.stylisticOrigins.length > 0 && (
            <p className="text-white/50">起源ジャンル: {info.stylisticOrigins.join(', ')}</p>
          )}
          {info.subgenres.length > 0 && <p className="text-white/50">サブジャンル: {info.subgenres.join(', ')}</p>}
          {info.derivatives.length > 0 && <p className="text-white/50">派生ジャンル: {info.derivatives.join(', ')}</p>}

          <form action={applyWikipediaGenreLookup} className="pt-1">
            <input type="hidden" name="genre_id" value={genreId} />
            <input type="hidden" name="source_url" value={info.sourceUrl} />
            <input type="hidden" name="origin_year" value={info.originYear ?? ''} />
            <input type="hidden" name="origin_place" value={info.originPlace ?? ''} />
            <input type="hidden" name="stylistic_origins_json" value={JSON.stringify(info.stylisticOrigins)} />
            <input type="hidden" name="subgenres_json" value={JSON.stringify(info.subgenres)} />
            <input type="hidden" name="derivatives_json" value={JSON.stringify(info.derivatives)} />
            <button
              type="submit"
              disabled={!genreId}
              className="rounded-md border border-white/15 px-3 py-1 text-xs hover:bg-white/5 disabled:opacity-40"
            >
              この内容で取込
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
