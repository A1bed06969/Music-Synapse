import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { fetchNewArrivalsDetail } from '@/utils/newArrivals'

function formatBoundary(iso: string): string {
  const jst = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000)
  const y = jst.getUTCFullYear()
  const m = jst.getUTCMonth() + 1
  const d = jst.getUTCDate()
  return `${y}/${m}/${d} 8:00〜`
}

const TABS = ['all', 'artist', 'album', 'track', 'festival', 'curation'] as const
type Tab = (typeof TABS)[number]

function isTab(value: string | undefined): value is Tab {
  return TABS.includes(value as Tab)
}

export default async function NewArrivalsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab: rawTab } = await searchParams
  const tab: Tab = isTab(rawTab) ? rawTab : 'all'

  const supabase = await createClient()
  const { boundary, counts, artists, albums, tracks, events, curationEntries } = await fetchNewArrivalsDetail(supabase)

  const total = counts.artist + counts.album + counts.track + counts.event + counts.curation

  const tabDefs: { key: Tab; label: string; count: number }[] = [
    { key: 'all', label: '全て', count: total },
    { key: 'artist', label: 'アーティスト', count: counts.artist },
    { key: 'album', label: 'アルバム', count: counts.album },
    { key: 'track', label: 'トラック', count: counts.track },
    { key: 'festival', label: 'フェス', count: counts.event },
    { key: 'curation', label: 'キュレーション', count: counts.curation },
  ]

  const showAll = tab === 'all'

  function truncatedNote(count: number, shown: number): string | null {
    return count > shown ? `(新しい順に${shown}件のみ表示。全${count}件)` : null
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/" className="text-xs text-white/40 hover:text-white/70">
        ← ホームに戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">新着情報</h1>
      <p className="mt-2 text-sm text-white/50">
        {formatBoundary(boundary)}に追加されたもの{total}件
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {tabDefs.map((t) => {
          const active = t.key === tab
          return (
            <Link
              key={t.key}
              href={t.key === 'all' ? '/new-arrivals' : `/new-arrivals?tab=${t.key}`}
              className={`rounded-full border px-4 py-1.5 text-sm transition ${
                active
                  ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-300'
                  : 'border-white/10 text-white/50 hover:border-white/25 hover:text-white/80'
              }`}
            >
              {t.label} <span className="text-xs opacity-70">({t.count})</span>
            </Link>
          )
        })}
      </div>

      {total === 0 && <p className="mt-10 text-sm text-white/40">まだ新着はありません。</p>}

      <div className="mt-8 flex flex-col gap-6">
        {(showAll || tab === 'artist') && artists.length > 0 && (
          <section className="rounded-xl border border-white/10 p-6">
            <h2 className="text-lg font-semibold">
              アーティスト({counts.artist})
              {truncatedNote(counts.artist, artists.length) && (
                <span className="ml-2 text-xs font-normal text-white/30">
                  {truncatedNote(counts.artist, artists.length)}
                </span>
              )}
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
              {artists.map((a) => (
                <Link key={a.id} href={`/artists/${a.id}`} className="group block">
                  <div className="aspect-square overflow-hidden rounded-full bg-white/5">
                    {a.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.imageUrl}
                        alt={a.name}
                        className="h-full w-full object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-2xl text-white/20">🎤</div>
                    )}
                  </div>
                  <p className="mt-2 truncate text-center text-sm group-hover:opacity-70">{a.name}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {(showAll || tab === 'album') && albums.length > 0 && (
          <section className="rounded-xl border border-white/10 p-6">
            <h2 className="text-lg font-semibold">
              アルバム({counts.album})
              {truncatedNote(counts.album, albums.length) && (
                <span className="ml-2 text-xs font-normal text-white/30">
                  {truncatedNote(counts.album, albums.length)}
                </span>
              )}
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
              {albums.map((a) => (
                <Link key={a.id} href={`/albums/${a.id}`} className="group block">
                  <div className="aspect-square overflow-hidden rounded-md bg-white/5">
                    {a.jacketUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.jacketUrl}
                        alt={a.title}
                        className="h-full w-full object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-2xl text-white/20">💿</div>
                    )}
                  </div>
                  <p className="mt-2 truncate text-sm group-hover:opacity-70">{a.title}</p>
                  <p className="truncate text-xs text-white/40">{a.artistName}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {(showAll || tab === 'track') && tracks.length > 0 && (
          <section className="rounded-xl border border-white/10 p-6">
            <h2 className="text-lg font-semibold">
              トラック({counts.track})
              {truncatedNote(counts.track, tracks.length) && (
                <span className="ml-2 text-xs font-normal text-white/30">
                  {truncatedNote(counts.track, tracks.length)}
                </span>
              )}
            </h2>
            <ul className="mt-4 space-y-1">
              {tracks.map((t) => (
                <li key={t.id}>
                  <Link href={`/tracks/${t.id}`} className="flex items-baseline gap-2 text-sm hover:opacity-70">
                    <span className="font-medium">{t.title}</span>
                    <span className="text-white/40">
                      {t.artistName}
                      {t.albumTitle ? ` — ${t.albumTitle}` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(showAll || tab === 'festival') && events.length > 0 && (
          <section className="rounded-xl border border-white/10 p-6">
            <h2 className="text-lg font-semibold">
              フェス({counts.event})
              {truncatedNote(counts.event, events.length) && (
                <span className="ml-2 text-xs font-normal text-white/30">
                  {truncatedNote(counts.event, events.length)}
                </span>
              )}
            </h2>
            <ul className="mt-4 space-y-1">
              {events.map((e) => (
                <li key={e.id}>
                  <Link href={`/artists/${e.artistId}`} className="flex items-baseline gap-2 text-sm hover:opacity-70">
                    <span className="font-medium">{e.artistName}</span>
                    <span className="text-white/40">{e.eventName}へ出演追加</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(showAll || tab === 'curation') && curationEntries.length > 0 && (
          <section className="rounded-xl border border-white/10 p-6">
            <h2 className="text-lg font-semibold">
              キュレーション({counts.curation})
              {truncatedNote(counts.curation, curationEntries.length) && (
                <span className="ml-2 text-xs font-normal text-white/30">
                  {truncatedNote(counts.curation, curationEntries.length)}
                </span>
              )}
            </h2>
            <ul className="mt-4 space-y-1">
              {curationEntries.map((c) => (
                <li key={c.id} className="text-sm">
                  <span className="text-white/40">{c.rankingName}</span> — {c.targetLabel}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
