import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { artworkAt } from '@/utils/artworkSize'
import { formatDate } from '@/utils/format'
import CurationVisual from '../CurationVisual'
import HubShell from '@/app/components/hub/HubShell'
import SectionHeading from '@/app/components/detail/SectionHeading'
import { hubContent } from '@/app/components/hub/hubContents'

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
    | { id: string; title: string; jacket_url: string | null; streaming_status: string | null; artist: { name: string } | { name: string }[] | null }
    | { id: string; title: string; jacket_url: string | null; streaming_status: string | null; artist: { name: string } | { name: string }[] | null }[]
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

  /** アルバム起点の選出だけ、サブスクで聴ける(配信中)かを持つ。streaming_statusが none / unreleased は未配信 */
  const streaming = album ? !['none', 'unreleased'].includes(album.streaming_status ?? '') : null

  return { id: entry.id, label, href, sub, imageUrl, isArtistOnly, periodDate: entry.period_date, streaming }
}

function TileGrid({ tiles }: { tiles: ReturnType<typeof toTile>[] }) {
  return (
    <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {tiles.map((tile) => {
        const content = (
          <>
            <div className={`relative aspect-square overflow-hidden bg-white/5 ${tile.isArtistOnly ? 'rounded-full' : 'rounded-md'}`}>
              {tile.streaming !== null && (
                <span
                  className={`absolute left-1.5 top-1.5 z-[1] rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-wide shadow ${
                    tile.streaming ? 'bg-emerald-400 text-black' : 'bg-black/75 text-amber-300 ring-1 ring-amber-300/60'
                  }`}
                >
                  {tile.streaming ? '配信中' : '未配信'}
                </span>
              )}
              {tile.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={artworkAt(tile.imageUrl, 400) ?? tile.imageUrl}
                  alt={tile.label}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition group-hover:scale-105"
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
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ status?: string }>
}) {
  const { id } = await params
  const { status } = await searchParams
  const supabase = await createClient()

  const { data: ranking, error } = await supabase
    .from('ranking')
    .select('id, name, source, description, list_type, image_url, source_url, media:media_id(id, name)')
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
       album:album_id(id, title, jacket_url, streaming_status, artist:artist_id(name)),
       artist:artist_id(id, name, image_url)`
    )
    .eq('ranking_id', id)
    .order(isSelection ? 'id' : 'rank', { ascending: true })

  const media = firstOf(ranking.media)

  // 複数年にまたがるselectionコンテンツ(Fender NEXT等、年ごとにクラスが分かれる
  // もの)は年見出しで区切って表示する。単一期間のコンテンツ(タワレコメンの
  // 月次選出等)では見出しを出す意味が無いため、実際に複数年ある時だけ分岐する。
  const allTiles = (entries ?? []).map((e) => toTile(e as Entry))
  // 配信状況タブ(アルバム選出が含まれるセレクションだけ)。絞り込み中はアーティスト単体などの選出は出さない
  const streamingCount = allTiles.filter((t) => t.streaming === true).length
  const unreleasedCount = allTiles.filter((t) => t.streaming === false).length
  const showStatusTabs = isSelection && streamingCount + unreleasedCount > 0
  const activeFilter = showStatusTabs && (status === 'streaming' || status === 'unreleased') ? status : 'all'
  const tiles = activeFilter === 'streaming' ? allTiles.filter((t) => t.streaming === true) : activeFilter === 'unreleased' ? allTiles.filter((t) => t.streaming === false) : allTiles
  const filters = [
    { key: 'all', label: 'すべて', count: allTiles.length, href: `/media/features/${id}` },
    { key: 'streaming', label: '配信中', count: streamingCount, href: `/media/features/${id}?status=streaming` },
    { key: 'unreleased', label: '未配信', count: unreleasedCount, href: `/media/features/${id}?status=unreleased` },
  ]
  const years = Array.from(new Set(tiles.map((t) => t.periodDate.slice(0, 4))))
  const hasMultipleYears = isSelection && years.length > 1

  const tilesByYear = hasMultipleYears
    ? years
        .sort((a, b) => Number(b) - Number(a))
        .map((year) => ({ year, tiles: tiles.filter((t) => t.periodDate.slice(0, 4) === year) }))
    : []

  const headerBlock = (
    <div>
      <Link href="/media/features" className="text-xs text-white/40 hover:text-white/70">
        ← キュレーションコンテンツ
      </Link>

      <div className="mt-4 empty:hidden">
        <CurationVisual imageUrl={ranking.image_url} name={ranking.name} jackets={allTiles.map((t) => t.imageUrl)} />
      </div>

      <p className="mt-4 text-xs text-white/40">{media?.name ?? ranking.source ?? 'メディア企画'}</p>
      <h2 className="mt-1 text-lg font-bold">{ranking.name}</h2>
      {ranking.description && <p className="mt-2 text-sm leading-relaxed text-white/70">{ranking.description}</p>}
      {ranking.source_url && (
        <a
          href={ranking.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-xs text-white/40 underline hover:text-white/70"
        >
          公式サイトを見る →
        </a>
      )}
    </div>
  )

  const c = hubContent('curation')

  const { data: rankings } = await supabase
    .from('ranking')
    .select('id, name, source, description, list_type, image_url, media:media_id(id, name)')
    .order('id', { ascending: false })

  // 右カラム: 一覧ページ(/media/features)の企画選択と同じカード。こちらは
  // 別ページへの遷移なのでLinkにしている
  const selectorBlock = (
    <div>
      <p className="mb-3 text-[11px] tracking-[0.2em] text-white/40">FEATURES</p>
      <div className="flex flex-col gap-3">
        {(rankings ?? []).map((r) => {
          const isActive = r.id === id
          return (
            <Link
              key={r.id}
              href={`/media/features/${r.id}`}
              style={isActive ? { borderColor: c.color, backgroundColor: `${c.color}1f` } : undefined}
              className={`flex min-w-0 gap-3 rounded-lg border p-3 text-left transition hover:bg-white/[0.06] ${
                isActive ? 'bg-white/[0.06]' : 'border-white/10 bg-white/[0.03]'
              }`}
            >
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-white/5">
                {r.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.image_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xl text-white/20">🎵</div>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs text-white/40">{firstOf(r.media)?.name ?? r.source ?? 'メディア企画'}</p>
                  <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] text-white/40">
                    {r.list_type === 'selection' ? '選出' : 'ランキング'}
                  </span>
                </div>
                <p className="mt-1 truncate font-semibold">{r.name}</p>
                {r.description && <p className="mt-1 truncate text-xs text-white/50">{r.description}</p>}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )

  return (
    <HubShell hubKey="curation" stats={[{ label: '件', value: allTiles.length }]} leftExtra={headerBlock} rightExtra={selectorBlock}>
      <SectionHeading number={c.number} label="PICKED ARTISTS & WORKS" color={c.color} />

      {!entries || entries.length === 0 ? (
        <p className="mt-10 text-sm text-white/40">
          {isSelection ? 'まだ選出されたコンテンツが登録されていません。' : 'まだランクインしたコンテンツが登録されていません。'}
        </p>
      ) : isSelection ? (
        <>
        {showStatusTabs && (
          <nav aria-label="配信状況" className="mt-6 flex flex-wrap gap-2">
            {filters.map((f) => (
              <Link
                key={f.key}
                href={f.href}
                scroll={false}
                aria-current={f.key === activeFilter ? 'page' : undefined}
                className={`rounded-full border px-3 py-1 text-xs font-bold transition ${
                  f.key === activeFilter ? 'border-white bg-white text-black' : 'border-white/15 text-white/70 hover:text-white'
                }`}
              >
                {f.label}
                <span className="ml-1.5 tabular-nums opacity-60">{f.count}</span>
              </Link>
            ))}
          </nav>
        )}
        {hasMultipleYears ? (
          tilesByYear.map((group) => (
            <section key={group.year} className="mt-14 first:mt-6">
              <div className="flex items-center gap-4">
                <h2 className="text-2xl font-bold text-white">
                  {group.year}
                  <span className="ml-1 text-sm font-medium text-white/40">年</span>
                </h2>
                <span className="h-px flex-1 bg-white/15" />
              </div>
              <TileGrid tiles={group.tiles} />
            </section>
          ))
        ) : (
          <TileGrid tiles={tiles} />
        )}
        </>
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
    </HubShell>
  )
}
