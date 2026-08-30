import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { formatDate } from '@/utils/format'

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function MediaFeatureDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: ranking, error } = await supabase
    .from('ranking')
    .select('id, name, source, description, list_type, media:media_id(id, name)')
    .eq('id', id)
    .single()

  if (error || !ranking) {
    notFound()
  }

  const isSelection = ranking.list_type === 'selection'

  const { data: entries } = await supabase
    .from('ranking_entry')
    .select(
      `id, rank, previous_rank, period_date, metric_value, metric_label,
       track:track_id(id, title, artist:artist_id(name), album:album_id(jacket_url)),
       album:album_id(id, title, jacket_url, artist:artist_id(name)),
       artist:artist_id(id, name)`
    )
    .eq('ranking_id', id)
    .order(isSelection ? 'id' : 'rank', { ascending: true })

  const media = firstOf(ranking.media)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/media/features" className="text-xs text-white/40 hover:text-white/70">
        ← キュレーションコンテンツ
      </Link>

      <p className="mt-4 text-xs text-white/40">{media?.name ?? ranking.source ?? 'メディア企画'}</p>
      <h1 className="mt-1 text-2xl font-bold">{ranking.name}</h1>
      {ranking.description && <p className="mt-3 text-sm leading-relaxed text-white/70">{ranking.description}</p>}

      {!entries || entries.length === 0 ? (
        <p className="mt-10 text-sm text-white/40">
          {isSelection ? 'まだ選出されたコンテンツが登録されていません。' : 'まだランクインしたコンテンツが登録されていません。'}
        </p>
      ) : isSelection ? (
        // ディスクガイドの掲載アルバム一覧と同じ、ジャケット中心のグリッド表示。
        // タワレコメン等の「順位のない選出リスト」は数字の羅列より、実物の
        // ジャケットが並ぶ方が一覧性・回遊性ともに高い。
        <ul className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {entries.map((entry) => {
            const track = firstOf(entry.track)
            const album = firstOf(entry.album)
            const artist = firstOf(entry.artist)
            const trackArtist = track ? firstOf(track.artist) : null
            const albumArtist = album ? firstOf(album.artist) : null
            const trackAlbum = track ? firstOf(track.album) : null

            const label = track?.title ?? album?.title ?? artist?.name ?? '—'
            const href = track ? `/tracks/${track.id}` : album ? `/albums/${album.id}` : artist ? `/artists/${artist.id}` : null
            const sub = track ? trackArtist?.name : album ? albumArtist?.name : null
            const jacketUrl = album?.jacket_url ?? trackAlbum?.jacket_url ?? null

            const content = (
              <>
                <div className="aspect-square overflow-hidden rounded-md bg-white/5">
                  {jacketUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={jacketUrl}
                      alt={label}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-2xl">💿</div>
                  )}
                </div>
                <p className="mt-2 truncate text-sm font-medium group-hover:opacity-70">{label}</p>
                {sub && <p className="truncate text-xs text-white/40">{sub}</p>}
                {entry.period_date && <p className="truncate text-[11px] text-white/25">{formatDate(entry.period_date)}</p>}
              </>
            )

            return (
              <li key={entry.id}>
                {href ? (
                  <Link href={href} className="group block">
                    {content}
                  </Link>
                ) : (
                  <div className="group">{content}</div>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <ol className="mt-8 divide-y divide-white/10">
          {entries.map((entry) => {
            const track = firstOf(entry.track)
            const album = firstOf(entry.album)
            const artist = firstOf(entry.artist)
            const trackArtist = track ? firstOf(track.artist) : null
            const albumArtist = album ? firstOf(album.artist) : null

            const label = track?.title ?? album?.title ?? artist?.name ?? '—'
            const href = track ? `/tracks/${track.id}` : album ? `/albums/${album.id}` : artist ? `/artists/${artist.id}` : null
            const sub = track ? trackArtist?.name : album ? albumArtist?.name : null

            return (
              <li key={entry.id} className="flex items-center gap-4 py-3">
                <span className="w-8 shrink-0 text-right text-lg font-bold text-white/30">{entry.rank}</span>
                <div className="flex-1">
                  {href ? (
                    <Link href={href} className="font-medium hover:opacity-70">
                      {label}
                    </Link>
                  ) : (
                    <span className="font-medium">{label}</span>
                  )}
                  {sub && <span className="ml-2 text-xs text-white/40">{sub}</span>}
                </div>
                <div className="shrink-0 text-right text-xs text-white/40">
                  {entry.metric_value != null && (
                    <p>
                      {entry.metric_value}
                      {entry.metric_label ? ` ${entry.metric_label}` : ''}
                    </p>
                  )}
                  {entry.period_date && <p>{formatDate(entry.period_date)}</p>}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
