'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
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

type Tab = 'artist' | 'member' | 'credit'

const TABS: { key: Tab; label: string }[] = [
  { key: 'artist', label: 'アーティスト' },
  { key: 'member', label: 'メンバー' },
  { key: 'credit', label: 'クレジット' },
]

const CREDIT_ROLE_TABS: { key: string; label: string }[] = [
  { key: 'all', label: 'すべて' },
  ...Object.entries(CREDIT_ROLE_LABEL).map(([key, label]) => ({ key, label })),
]

function matchesQuery(q: string, ...fields: (string | null | undefined)[]): boolean {
  return fields.some((f) => (f ?? '').toLowerCase().includes(q))
}

export default function ArtistBrowseClient({
  artists,
  members,
  credits,
  allInstruments,
}: {
  artists: Artist[]
  members: Member[]
  credits: CreditPerson[]
  allInstruments: string[]
}) {
  const [tab, setTab] = useState<Tab>('artist')
  const [creditRole, setCreditRole] = useState<string>('all')
  const [instrument, setInstrument] = useState<string>('all')
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()

  const filteredArtists = useMemo(
    () => (q ? artists.filter((a) => matchesQuery(q, a.name, a.name_kana, a.name_en)) : artists),
    [artists, q]
  )
  const filteredMembers = useMemo(
    () => (q ? members.filter((m) => matchesQuery(q, m.name, m.name_kana, m.name_en)) : members),
    [members, q]
  )
  const filteredCredits = useMemo(() => {
    const byRole = creditRole === 'all' ? credits : credits.filter((c) => c.roles.includes(creditRole))
    const byInstrument =
      creditRole === 'musician' && instrument !== 'all'
        ? byRole.filter((c) => c.instruments.includes(instrument))
        : byRole
    return q ? byInstrument.filter((c) => matchesQuery(q, c.name)) : byInstrument
  }, [credits, creditRole, instrument, q])

  const placeholder =
    tab === 'artist' ? 'アーティスト名で絞り込み...' : tab === 'member' ? 'メンバー名で絞り込み...' : 'クレジット人物名で絞り込み...'

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">アーティスト</h1>

      <div className="mt-6 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
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
        value={query}
        onChange={(e) => setQuery(e.target.value)}
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
              onClick={() => setCreditRole(r.key)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                creditRole === r.key
                  ? 'border-white bg-white text-black font-medium'
                  : 'border-white/15 bg-white/5 text-white/60 hover:border-white/30'
              }`}
            >
              {r.label}
            </button>
          ))}
          {creditRole === 'musician' && allInstruments.length > 0 && (
            <select
              value={instrument}
              onChange={(e) => setInstrument(e.target.value)}
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

      {tab === 'artist' && (
        <ArtistGrid
          items={filteredArtists}
          emptyMessage="該当するアーティストが見つかりませんでした。"
        />
      )}
      {tab === 'member' && (
        <MemberGrid items={filteredMembers} emptyMessage="該当するメンバーが見つかりませんでした。" />
      )}
      {tab === 'credit' && (
        <CreditList items={filteredCredits} emptyMessage="該当するクレジット人物が見つかりませんでした。" />
      )}
    </div>
  )
}

function ArtistGrid({ items, emptyMessage }: { items: Artist[]; emptyMessage: string }) {
  return (
    <>
      <p className="mt-3 text-xs text-white/40">{items.length}件</p>
      {items.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">{emptyMessage}</p>
      ) : (
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
      )}
    </>
  )
}

function MemberGrid({ items, emptyMessage }: { items: Member[]; emptyMessage: string }) {
  return (
    <>
      <p className="mt-3 text-xs text-white/40">{items.length}件</p>
      {items.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">{emptyMessage}</p>
      ) : (
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
      )}
    </>
  )
}

function CreditList({ items, emptyMessage }: { items: CreditPerson[]; emptyMessage: string }) {
  return (
    <>
      <p className="mt-3 text-xs text-white/40">{items.length}件</p>
      {items.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">{emptyMessage}</p>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((person) => (
            <li key={person.id} className="border-b border-white/5 py-2.5">
              <Link href={`/people/${person.id}`} className="text-sm font-medium hover:opacity-70">
                {person.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
