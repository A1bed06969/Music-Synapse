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

export default async function NewArrivalsPage() {
  const supabase = await createClient()
  const { boundary, artists, albums, tracks, events, curationEntries } = await fetchNewArrivalsDetail(supabase)

  const total = artists.length + albums.length + tracks.length + events.length + curationEntries.length

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/" className="text-xs text-white/40 hover:text-white/70">
        ← ホームに戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">新着情報</h1>
      <p className="mt-2 text-sm text-white/50">
        {formatBoundary(boundary)}に追加されたもの{total}件
      </p>

      {total === 0 && <p className="mt-10 text-sm text-white/40">まだ新着はありません。</p>}

      {artists.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">アーティスト({artists.length})</h2>
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

      {albums.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">アルバム({albums.length})</h2>
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

      {tracks.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">トラック({tracks.length})</h2>
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

      {events.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">イベント({events.length})</h2>
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

      {curationEntries.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">キュレーション({curationEntries.length})</h2>
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
  )
}
