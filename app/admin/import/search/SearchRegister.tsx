'use client'

import { useEffect, useRef, useState } from 'react'
import {
  searchForRegistration,
  registerArtistFromSearch,
  registerAlbumFromSearch,
  registerTrackFromSearch,
  type SearchArtistItem,
  type SearchAlbumItem,
  type SearchTrackItem,
} from './actions'

const HISTORY_KEY = 'ms_import_search_history'
const HISTORY_MAX = 8
const DEBOUNCE_MS = 300
const MIN_QUERY_LENGTH = 2

const inputClass =
  'w-full rounded-md border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none'

type ItemKey = `artist:${number}` | `album:${number}` | `track:${number}`

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function saveHistory(term: string) {
  try {
    const current = loadHistory().filter((h) => h !== term)
    const updated = [term, ...current].slice(0, HISTORY_MAX)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated))
  } catch {
    // localStorageが使えない環境は無視(検索履歴は無くても機能に支障はない)
  }
}

export default function SearchRegister() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ artists: SearchArtistItem[]; albums: SearchAlbumItem[]; tracks: SearchTrackItem[] } | null>(
    null
  )
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [registeringKey, setRegisteringKey] = useState<ItemKey | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const trimmedQuery = query.trim()
  const queryTooShort = trimmedQuery.length < MIN_QUERY_LENGTH

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (queryTooShort) return

    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      setSearchError(null)
      try {
        const result = await searchForRegistration(query)
        setResults(result)
        saveHistory(query.trim())
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : '検索に失敗しました。')
      } finally {
        setSearching(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, queryTooShort])

  function handleFocus() {
    setHistory(loadHistory())
    setShowHistory(true)
  }

  function markRegistered(key: ItemKey) {
    setResults((prev) => {
      if (!prev) return prev
      if (key.startsWith('artist:')) {
        const id = Number(key.slice('artist:'.length))
        return { ...prev, artists: prev.artists.map((a) => (a.artistId === id ? { ...a, alreadyRegistered: true } : a)) }
      }
      if (key.startsWith('album:')) {
        const id = Number(key.slice('album:'.length))
        return { ...prev, albums: prev.albums.map((a) => (a.collectionId === id ? { ...a, alreadyRegistered: true } : a)) }
      }
      const id = Number(key.slice('track:'.length))
      return { ...prev, tracks: prev.tracks.map((t) => (t.trackId === id ? { ...t, alreadyRegistered: true } : t)) }
    })
  }

  async function handleRegister(key: ItemKey, action: () => Promise<{ success: boolean; message: string }>) {
    setRegisteringKey(key)
    setToast(null)
    try {
      const result = await action()
      setToast({ kind: result.success ? 'success' : 'error', message: result.message })
      if (result.success) markRegistered(key)
    } catch (err) {
      setToast({ kind: 'error', message: err instanceof Error ? err.message : '登録処理中にエラーが発生しました。' })
    } finally {
      setRegisteringKey(null)
    }
  }

  const activeResults = queryTooShort ? null : results
  const hasResults =
    activeResults &&
    (activeResults.artists.length > 0 || activeResults.albums.length > 0 || activeResults.tracks.length > 0)

  return (
    <div className="mt-6">
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={handleFocus}
          onBlur={() => setTimeout(() => setShowHistory(false), 150)}
          placeholder="アーティスト名・アルバム名・曲名で検索(2文字以上)"
          className={inputClass}
        />
        {showHistory && query.trim().length === 0 && history.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-white/15 bg-[#0a0a0a] p-2 shadow-lg">
            <p className="px-2 py-1 text-xs text-white/40">最近の検索</p>
            {history.map((h) => (
              <button
                key={h}
                type="button"
                onMouseDown={() => setQuery(h)}
                className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-white/70 hover:bg-white/5"
              >
                {h}
              </button>
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div
          className={`mt-4 rounded-md border px-4 py-3 text-sm ${
            toast.kind === 'success' ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'
          }`}
        >
          {toast.message}
        </div>
      )}

      {searching && <p className="mt-4 text-sm text-white/40">検索中...</p>}
      {searchError && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{searchError}</div>
      )}

      {!searching && activeResults && !hasResults && (
        <p className="mt-4 text-sm text-white/40">該当する候補が見つかりませんでした。</p>
      )}

      {activeResults && activeResults.artists.length > 0 && (
        <ResultSection
          label="アーティスト"
          badgeClass="border-sky-400/40 text-sky-300"
          items={activeResults.artists.map((a) => ({
            key: `artist:${a.artistId}` as ItemKey,
            title: a.artistName,
            subtitle: a.primaryGenreName ?? null,
            artworkUrl: null,
            alreadyRegistered: a.alreadyRegistered,
            onRegister: () => registerArtistFromSearch(a.artistId),
          }))}
          registeringKey={registeringKey}
          onRegister={handleRegister}
        />
      )}

      {activeResults && activeResults.albums.length > 0 && (
        <ResultSection
          label="アルバム"
          badgeClass="border-emerald-400/40 text-emerald-300"
          items={activeResults.albums.map((a) => ({
            key: `album:${a.collectionId}` as ItemKey,
            title: a.collectionName,
            subtitle: a.artistName,
            artworkUrl: a.artworkUrl100 ?? null,
            alreadyRegistered: a.alreadyRegistered,
            onRegister: () => registerAlbumFromSearch(a.collectionId),
          }))}
          registeringKey={registeringKey}
          onRegister={handleRegister}
        />
      )}

      {activeResults && activeResults.tracks.length > 0 && (
        <ResultSection
          label="トラック"
          badgeClass="border-orange-400/40 text-orange-300"
          items={activeResults.tracks.map((t) => ({
            key: `track:${t.trackId}` as ItemKey,
            title: t.trackName,
            subtitle: `${t.artistName} ・ ${t.collectionName}`,
            artworkUrl: t.artworkUrl100 ?? null,
            alreadyRegistered: t.alreadyRegistered,
            onRegister: () => registerTrackFromSearch(t.collectionId),
          }))}
          registeringKey={registeringKey}
          onRegister={handleRegister}
        />
      )}
    </div>
  )
}

type ResultRow = {
  key: ItemKey
  title: string
  subtitle: string | null
  artworkUrl: string | null
  alreadyRegistered: boolean
  onRegister: () => Promise<{ success: boolean; message: string }>
}

function ResultSection({
  label,
  badgeClass,
  items,
  registeringKey,
  onRegister,
}: {
  label: string
  badgeClass: string
  items: ResultRow[]
  registeringKey: ItemKey | null
  onRegister: (key: ItemKey, action: () => Promise<{ success: boolean; message: string }>) => void
}) {
  return (
    <div className="mt-6">
      <p className="text-xs uppercase tracking-wide text-white/40">{label}</p>
      <div className="mt-2 space-y-1.5">
        {items.map((item) => {
          const isRegistering = registeringKey === item.key
          return (
            <div
              key={item.key}
              className="flex items-center gap-3 rounded-md border border-white/15 px-3 py-2 text-sm"
            >
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${badgeClass}`}>{label}</span>
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-white/5">
                {item.artworkUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.artworkUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-white/20">🎤</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.title}</p>
                {item.subtitle && <p className="truncate text-xs text-white/40">{item.subtitle}</p>}
              </div>
              {item.alreadyRegistered ? (
                <span className="shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/40">
                  登録済み
                </span>
              ) : (
                <button
                  type="button"
                  disabled={isRegistering}
                  onClick={() => onRegister(item.key, item.onRegister)}
                  className="shrink-0 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-black transition hover:bg-white/85 disabled:opacity-40"
                >
                  {isRegistering ? '登録中...' : '登録する'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
