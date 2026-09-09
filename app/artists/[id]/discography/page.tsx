// app/artists/[id]/discography/page.tsx
import Link from 'next/link'
import { Suspense } from 'react'
import { createClient } from '@/utils/Supabase/server'
import { buildArtistAlbumQuery } from '@/utils/artistAlbumQuery'
import { formatDate, STREAMING_STATUS_LABEL } from '@/utils/format'
import { ALBUM_TYPE_LABEL_JA, classifyAlbumType } from '@/utils/albumType'
import { ALBUM_FAMILY, SINGLE_FAMILY, type DiscographyType, type DiscographyCounts } from '@/utils/discographyCategories'
import DiscographyFilters from '@/app/components/artist-detail/DiscographyFilters'

const PAGE_SIZE = 60 // 3列グリッドに揃うよう3の倍数(既存/albumsページと同じ単位)

type AlbumRow = {
  id: string
  title: string
  jacket_url: string | null
  release_date: string | null
  streaming_status: string | null
  track_count: number | null
  label: { name: string } | { name: string }[] | null
}

const UNRELEASED_VALUES = ['none', 'unreleased']
const DISCOGRAPHY_LABEL_JA: Record<DiscographyType, string> = { ...ALBUM_TYPE_LABEL_JA, Omnibus: 'オムニバス' }

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function isVariousArtistsName(name: string): boolean {
  return /various/i.test(name) || /^v\.a\.?$/i.test(name) || name === 'V/A'
}

type OmnibusJoinRow = {
  album:
    | { id: string; artist: { name: string } | { name: string }[] | null }
    | { id: string; artist: { name: string } | { name: string }[] | null }[]
    | null
}

/** 「アルバム名義はVarious Artists等だが、収録曲はこのアーティスト名義」という
 * オムニバス(コンピレーション)収録を検出する。track_artist(コラボ曲の多対多)
 * とtrack.artist_id(直接指定)の両方を見る — 本番データでは前者のみに実例が
 * あるが(HiGH & LOW ORIGINAL BEST ALBUM等)、後者の形でデータが入る可能性も
 * 排除しない。Various Artists名義かどうかはSQLではなくJS側で判定する
 * (3階層のネストしたembedへのilikeフィルタは壊れやすいため)。 */
async function fetchOmnibusAlbumIds(supabase: Awaited<ReturnType<typeof createClient>>, artistId: string): Promise<string[]> {
  const [viaTrackArtist, viaTrackDirect] = await Promise.all([
    supabase
      .from('track_artist')
      .select('track:track_id!inner(album:album_id!inner(id, artist:artist_id!inner(name)))')
      .eq('artist_id', artistId)
      .overrideTypes<{ track: { album: OmnibusJoinRow['album'] } | { album: OmnibusJoinRow['album'] }[] | null }[], { merge: false }>(),
    supabase
      .from('track')
      .select('album:album_id!inner(id, artist:artist_id!inner(name))')
      .eq('artist_id', artistId)
      .overrideTypes<OmnibusJoinRow[], { merge: false }>(),
  ])

  const ids = new Set<string>()
  const collect = (albumField: OmnibusJoinRow['album']) => {
    const album = firstOf(albumField)
    if (!album) return
    const artist = firstOf(album.artist)
    if (artist && isVariousArtistsName(artist.name)) ids.add(album.id)
  }
  for (const row of viaTrackArtist.data ?? []) {
    const track = firstOf(row.track)
    if (track) collect(track.album)
  }
  for (const row of viaTrackDirect.data ?? []) {
    collect(row.album)
  }
  return Array.from(ids)
}

export default async function DiscographyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ category?: string; type?: string; status?: string; page?: string }>
}) {
  const { id } = await params
  const { category: categoryParam, type: typeParam, status: statusParam, page: pageParam } = await searchParams
  const category = categoryParam === 'album' || categoryParam === 'single' ? categoryParam : 'all'
  const family = category === 'album' ? ALBUM_FAMILY : category === 'single' ? SINGLE_FAMILY : null
  const type = family && (family as string[]).includes(typeParam ?? '') ? (typeParam as DiscographyType) : 'all'
  const status = statusParam === 'streaming' || statusParam === 'unreleased' ? statusParam : 'all'
  const page = Math.max(0, Number(pageParam ?? 0) || 0)

  const supabase = await createClient()
  const [{ data }, omnibusAlbumIds] = await Promise.all([
    buildArtistAlbumQuery<AlbumRow>(
      supabase,
      id,
      'id, title, jacket_url, release_date, streaming_status, track_count, label:label_id(name)'
    ),
    fetchOmnibusAlbumIds(supabase, id),
  ])

  const mainAlbumIds = new Set((data ?? []).map((a) => a.id))
  const newOmnibusIds = omnibusAlbumIds.filter((oid) => !mainAlbumIds.has(oid))
  const { data: omnibusRows } =
    newOmnibusIds.length > 0
      ? await supabase
          .from('album')
          .select('id, title, jacket_url, release_date, streaming_status, track_count, label:label_id(name)')
          .in('id', newOmnibusIds)
          .is('primary_album_id', null)
          .overrideTypes<AlbumRow[], { merge: false }>()
      : { data: [] as AlbumRow[] }

  const mainAlbums = (data ?? []).map((a) => ({ ...a, albumType: classifyAlbumType(a.title, a.track_count) as DiscographyType }))
  const omnibusAlbums = (omnibusRows ?? []).map((a) => ({ ...a, albumType: 'Omnibus' as const }))
  let albums = [...mainAlbums, ...omnibusAlbums].sort((a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? ''))

  const counts: DiscographyCounts = { Album: 0, EP: 0, Single: 0, Remix: 0, Live: 0, Best: 0, Omnibus: 0, albumFamily: 0, singleFamily: 0 }
  for (const a of albums) counts[a.albumType]++
  counts.albumFamily = ALBUM_FAMILY.reduce((sum, t) => sum + counts[t], 0)
  counts.singleFamily = SINGLE_FAMILY.reduce((sum, t) => sum + counts[t], 0)

  if (category === 'album') albums = albums.filter((a) => (ALBUM_FAMILY as string[]).includes(a.albumType))
  else if (category === 'single') albums = albums.filter((a) => (SINGLE_FAMILY as string[]).includes(a.albumType))
  if (category !== 'all' && type !== 'all') albums = albums.filter((a) => a.albumType === type)
  if (status === 'streaming') albums = albums.filter((a) => !UNRELEASED_VALUES.includes(a.streaming_status ?? ''))
  else if (status === 'unreleased') albums = albums.filter((a) => UNRELEASED_VALUES.includes(a.streaming_status ?? ''))

  const totalCount = albums.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const pageItems = albums.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  return (
    <div>
      <h2 className="text-xs uppercase tracking-wide text-white/40">Discography</h2>
      <div className="mt-3">
        {/* useSearchParamsを使うためSuspenseで包む(静的生成時のビルドエラー回避)。 */}
        <Suspense fallback={null}>
          <DiscographyFilters category={category} type={type} status={status} counts={counts} />
        </Suspense>
      </div>
      <p className="mt-3 text-xs text-white/40">{totalCount}件</p>

      {pageItems.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">該当する作品が見つかりませんでした。</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
          {pageItems.map((album) => {
            const label = firstOf(album.label)
            const statusInfo = album.streaming_status ? STREAMING_STATUS_LABEL[album.streaming_status] : null
            return (
              <Link key={album.id} href={`/albums/${album.id}`} className="group block">
                <div className="aspect-square overflow-hidden rounded-md bg-white/5">
                  {album.jacket_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={album.jacket_url} alt={album.title} className="h-full w-full object-cover transition group-hover:opacity-80" />
                  )}
                </div>
                <p className="mt-2 truncate text-sm font-medium">{album.title}</p>
                <p className="truncate text-xs text-white/40">
                  {formatDate(album.release_date)} · {DISCOGRAPHY_LABEL_JA[album.albumType]}
                </p>
                {label && <p className="truncate text-xs text-white/30">{label.name}</p>}
                {statusInfo && <p className="text-xs text-white/50">{statusInfo.icon} {statusInfo.label}</p>}
              </Link>
            )
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-4 text-xs text-white/50">
          {page > 0 && (
            <Link
              href={`?${new URLSearchParams({ ...(category !== 'all' && { category }), ...(type !== 'all' && { type }), ...(status !== 'all' && { status }), page: String(page - 1) }).toString()}`}
            >
              ← 前へ
            </Link>
          )}
          <span>{page + 1} / {totalPages}</span>
          {page + 1 < totalPages && (
            <Link
              href={`?${new URLSearchParams({ ...(category !== 'all' && { category }), ...(type !== 'all' && { type }), ...(status !== 'all' && { status }), page: String(page + 1) }).toString()}`}
            >
              次へ →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
