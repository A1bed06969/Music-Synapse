'use client'

import { useState } from 'react'
import { importArtistsFromItunes } from './actions'

type ImportResult = {
  success: boolean
  message: string
  sourceUrl: string
  artistName?: string
  albumCount?: number
}

export default function ImportForm() {
  const [urlsText, setUrlsText] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<ImportResult[]>([])

  async function handleImport(e: React.FormEvent) {
    e.preventDefault()
    const urls = urlsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    if (urls.length === 0) return

    setLoading(true)
    setResults([])
    const res = await importArtistsFromItunes(urls)
    setResults(res)
    setLoading(false)
  }

  return (
    <>
      <form onSubmit={handleImport} className="mt-6">
        <textarea
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
          placeholder={'https://music.apple.com/jp/artist/xxxxx/12345678\nhttps://music.apple.com/jp/artist/yyyyy/87654321'}
          rows={6}
          className="w-full rounded-md border border-white/15 bg-white/5 px-4 py-3 font-mono text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="mt-3 rounded-md bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-white/85 disabled:opacity-40"
        >
          {loading ? '登録中...' : '一括登録する'}
        </button>
      </form>

      {results.length > 0 && (
        <div className="mt-8 space-y-3">
          {results.map((result, i) => (
            <div
              key={i}
              className={`rounded-md border px-4 py-3 text-sm ${
                result.success ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'
              }`}
            >
              <p className="truncate text-xs text-white/40">{result.sourceUrl}</p>
              <p className="mt-1">{result.message}</p>
              {result.success && (
                <ul className="mt-1.5 flex flex-wrap gap-x-4 text-xs text-white/50">
                  <li>アーティスト: {result.artistName}</li>
                  <li>アルバム数: {result.albumCount}</li>
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
