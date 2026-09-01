import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { formatDate } from '@/utils/format'

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

type Entry = {
  id: number
  rank: number | null
  previous_rank: number | null
  period_date: string
  metric_value: number | null
  metric_label: string | null
  track:
    | { id: string; title: string; artist: { name: string } | { name: string }[] | null; album: { jacket_url: string | null } | { jacket_url: string | null }[] | null }
    | { id: string; title: string; artist: { name: string } | { name: string }[] | null; album: { jacket_url: string | null } | { jacket_url: string | null }[] | null }[]
    | null
  album:
    | { id: string; title: string; jacket_url: string | null; artist: { name: string } | { name: string }[] | null }
    | { id: string; title: string; jacket_url: string | null; artist: { name: string } | { name: string }[] | null }[]
    | null
  artist:
    | { id: string; name: string; image_url: string | null }
    | { id: string; name: string; image_url: string | null }[]
    | null
}

/** selection型の1件をジャケット中心のタイルに変換する。トラック/アルバム起点
 * ならそのジャケット、アーティスト直接指定(Fender NEXT等)ならアーティスト画像
 * を使う(旧実装ではここが無く、アーティスト単体の選出が常に💿プレースホルダーに
 * なっていた)。 */
function toTile(entry: Entry) {
  const track = firstOf(entry.track)
  const album = firstOf(entry.album)
  const artist = firstOf(entry.artist)
  const trackArtist = track ? firstOf(track.artist) : null
  const albumArtist = album ? firstOf(album.artist) : null
  const trackAlbum = track ? firstOf(track.album) : null

  const label = track?.title ?? album?.title ?? artist?.name ?? '—'
  const href = track ? `/tracks/${track.id}` : album ? `/albums/${album.id}` : artist ? `/artists/${artist.id}` : null
  const sub = track ? trackArtist?.name : album ? albumArtist?.name : null
  const imageUrl = album?.jacket_url ?? trackAlbum?.jacket_url ?? artist?.image_url ?? null
  const isArtistOnly = !track && !album && !!artist

  return { id: entry.id, label, href, sub, imageUrl, isArtistOnly, periodDate: entry.period_date }
}

function TileGrid({ tiles }: { tiles: ReturnType<typeof toTile>[] }) {
  return (
    <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {tiles.map((tile) => {
        const content = (
          <>
            <div className={`aspect-square overflow-hidden bg-white/5 ${tile.isArtistOnly ? 'rounded-full' : 'rounded-md'}`}>
              {tile.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={tile.imageUrl}
                  alt={tile.label}
                  className={`h-full w-full transition group-hover:scale-105 ${tile.isArtistOnly ? 'object-cover' : 'object-cover'}`}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl">{tile.isArtistOnly ? '🎤' : '💿'}</div>
              )}
            </div>
            <p className="mt-2 truncate text-sm font-medium group-hover:opacity-70">{tile.label}</p>
            {tile.sub && <p className="truncate text-xs text-white/40">{tile.sub}</p>}
          </>
        )
        return (
          <li key={tile.id}>
            {tile.href ? (
              <Link href={tile.href} className="group block">
                {content}
              </Link>
            ) : (
              <div className="group">{content}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
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
       artist:artist_id(id, name, image_url)`
    )
    .eq('ranking_id', id)
    .order(isSelection ? 'id' : 'rank', { ascending: true })

  const media = firstOf(ranking.media)

  // 複数年にまたがるselectionコンテンツ(Fender NEXT等、年ごとにクラスが分かれる
  // もの)は年見出しで区切って表示する。単一期間のコンテンツ(タワレコメンの
  // 月次選出等)では見出しを出す意味が無いため、実際に複数年ある時だけ分岐する。
  const tiles = (entries ?? []).map((e) => toTile(e as Entry))
  const years = Array.from(new Set(tiles.map((t) => t.periodDate.slice(0, 4))))
  const hasMultipleYears = isSelection && years.length > 1

  const tilesByYear = hasMultipleYears
    ? years
        .sort((a, b) => Number(b) - Number(a))
        .map((year) => ({ year, tiles: tiles.filter((t) => t.periodDate.slice(0, 4) === year) }))
    : []

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
        hasMultipleYears ? (
          tilesByYear.map((group) => (
            <section key={group.year} className="mt-10 first:mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-white/50">{group.year}</h2>
              <TileGrid tiles={group.tiles} />
            </section>
          ))
        ) : (
          <TileGrid tiles={tiles} />
        )
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
