'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { CREDIT_ROLE_LABEL } from '@/utils/format'

type Artist = {
  id: string
  name: string
  name_kana: string | null
  name_en: string | null
  image_url: string | null
}

type Member = Artist & { bandNames: string[] }

type CreditPerson = { id: string; name: string; roles: string[]; instruments: string[] }

export type BrowseTab = 'artist' | 'member' | 'credit'

const TABS: { key: BrowseTab; label: string }[] = [
  { key: 'artist', label: 'アーティスト' },
  { key: 'member', label: 'メンバー' },
  { key: 'credit', label: 'クレジット' },
]

const CREDIT_ROLE_TABS: { key: string; label: string }[] = [
  { key: 'all', label: 'すべて' },
  ...Object.entries(CREDIT_ROLE_LABEL).map(([key, label]) => ({ key, label })),
]

const SEARCH_DEBOUNCE_MS = 300

/** 一覧の絞り込み・ページングはすべてURLのクエリパラメータで表す
 * (サーバー側でDBを絞るため)。戻る/進むや共有URLでも同じ結果が再現できる。 */
export default function ArtistBrowseClient({
  tab,
  query,
  page,
  role,
  instrument,
  pageSize,
  totalCount,
  artists,
  members,
  credits,
  allInstruments,
}: {
  tab: BrowseTab
  query: string
  page: number
  role: string
  instrument: string
  pageSize: number
  totalCount: number
  artists: Artist[]
  members: Member[]
  credits: CreditPerson[]
  allInstruments: string[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  const [inputValue, setInputValue] = useState(query)
  const isFirstRender = useRef(true)

  // 入力のたびにサーバーへ行かないよう、打ち終わりを待ってURLを更新する
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    const timer = setTimeout(() => {
      if (inputValue.trim() === query) return
      navigate({ q: inputValue.trim() || null, page: null })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // navigateはレンダーごとに作り直されるため依存に入れない(入れると毎回発火する)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue, query])

  function navigate(changes: Record<string, string | null>) {
    const params = new URLSearchParams()
    const base: Record<string, string | null> = {
      tab: tab === 'artist' ? null : tab,
      q: query || null,
      page: page > 0 ? String(page) : null,
      role: role !== 'all' ? role : null,
      instrument: instrument !== 'all' ? instrument : null,
      ...changes,
    }
    for (const [key, value] of Object.entries(base)) {
      if (value) params.set(key, value)
    }
    const search = params.toString()
    startTransition(() => {
      router.push(search ? `${pathname}?${search}` : pathname)
    })
  }

  const placeholder =
    tab === 'artist' ? 'アーティスト名で絞り込み...' : tab === 'member' ? 'メンバー名で絞り込み...' : 'クレジット人物名で絞り込み...'

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const rangeStart = totalCount === 0 ? 0 : page * pageSize + 1
  const rangeEnd = Math.min((page + 1) * pageSize, totalCount)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">アーティスト</h1>

      <div className="mt-6 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => navigate({ tab: t.key === 'artist' ? null : t.key, page: null })}
            className={`rounded-full border px-4 py-1.5 text-sm transition ${
              tab === t.key
                ? 'border-white bg-white text-black font-medium'
                : 'border-white/15 bg-white/5 text-white/70 hover:border-white/30'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder={placeholder}
        className="mt-4 w-full max-w-md rounded-md border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
        autoFocus
      />

      {tab === 'credit' && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {CREDIT_ROLE_TABS.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => navigate({ role: r.key === 'all' ? null : r.key, instrument: null, page: null })}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                role === r.key
                  ? 'border-white bg-white text-black font-medium'
                  : 'border-white/15 bg-white/5 text-white/60 hover:border-white/30'
              }`}
            >
              {r.label}
            </button>
          ))}
          {role === 'musician' && allInstruments.length > 0 && (
            <select
              value={instrument}
              onChange={(e) => navigate({ instrument: e.target.value === 'all' ? null : e.target.value, page: null })}
              className="ml-2 rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white focus:border-white/30 focus:outline-none"
            >
              <option value="all">楽器: すべて</option>
              {allInstruments.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <p className={`mt-3 text-xs ${isPending ? 'text-white/25' : 'text-white/40'}`}>
        {totalCount}件{totalCount > 0 && `(${rangeStart}〜${rangeEnd}件目を表示)`}
      </p>

      {tab === 'artist' && <ArtistGrid items={artists} emptyMessage="該当するアーティストが見つかりませんでした。" />}
      {tab === 'member' && <MemberGrid items={members} emptyMessage="該当するメンバーが見つかりませんでした。" />}
      {tab === 'credit' && <CreditList items={credits} emptyMessage="該当するクレジット人物が見つかりませんでした。" />}

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-4 text-xs text-white/50">
          <button
            type="button"
            onClick={() => navigate({ page: page - 1 > 0 ? String(page - 1) : null })}
            disabled={page === 0}
            className="rounded border border-white/15 px-3 py-1.5 transition hover:border-white/30 hover:text-white disabled:opacity-30 disabled:hover:border-white/15"
          >
            ← 前へ
          </button>
          <span>
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => navigate({ page: String(page + 1) })}
            disabled={page + 1 >= totalPages}
            className="rounded border border-white/15 px-3 py-1.5 transition hover:border-white/30 hover:text-white disabled:opacity-30 disabled:hover:border-white/15"
          >
            次へ →
          </button>
        </div>
      )}
    </div>
  )
}

function ArtistGrid({ items, emptyMessage }: { items: Artist[]; emptyMessage: string }) {
  if (items.length === 0) return <p className="mt-8 text-sm text-white/40">{emptyMessage}</p>
  return (
    <div className="mt-6 grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
      {items.map((artist) => (
        <Link key={artist.id} href={`/artists/${artist.id}`} className="group block">
          <div className="aspect-square overflow-hidden rounded-full bg-white/5">
            {artist.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={artist.image_url}
                alt={artist.name}
                loading="lazy"
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white/20">?</div>
            )}
          </div>
          <p className="mt-2 truncate text-center text-xs font-medium">{artist.name}</p>
        </Link>
      ))}
    </div>
  )
}

function MemberGrid({ items, emptyMessage }: { items: Member[]; emptyMessage: string }) {
  if (items.length === 0) return <p className="mt-8 text-sm text-white/40">{emptyMessage}</p>
  return (
    <div className="mt-6 grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
      {items.map((member) => (
        <Link key={member.id} href={`/artists/${member.id}`} className="group block">
          <div className="aspect-square overflow-hidden rounded-full bg-white/5">
            {member.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={member.image_url}
                alt={member.name}
                loading="lazy"
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white/20">🎤</div>
            )}
          </div>
          <p className="mt-2 truncate text-center text-xs font-medium">{member.name}</p>
          {member.bandNames.length > 0 && (
            <p className="truncate text-center text-[10px] text-white/40">{member.bandNames.join(' / ')}</p>
          )}
        </Link>
      ))}
    </div>
  )
}

function CreditList({ items, emptyMessage }: { items: CreditPerson[]; emptyMessage: string }) {
  if (items.length === 0) return <p className="mt-8 text-sm text-white/40">{emptyMessage}</p>
  return (
    <ul className="mt-6 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((person) => (
        <li key={person.id} className="border-b border-white/5 py-2.5">
          <Link href={`/people/${person.id}`} className="text-sm font-medium hover:opacity-70">
            {person.name}
          </Link>
        </li>
      ))}
    </ul>
  )
}
