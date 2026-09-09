// app/artists/[id]/discography/page.tsx
import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { buildArtistAlbumQuery } from '@/utils/artistAlbumQuery'
import { STREAMING_STATUS_LABEL } from '@/utils/format'
import { ALBUM_TYPE_LABEL_JA, ALBUM_TYPE_ORDER, classifyAlbumType, type AlbumType } from '@/utils/albumType'
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

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function DiscographyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ type?: string; status?: string; page?: string }>
}) {
  const { id } = await params
  const { type: typeParam, status: statusParam, page: pageParam } = await searchParams
  const type = ALBUM_TYPE_ORDER.includes(typeParam as AlbumType) ? (typeParam as AlbumType) : 'all'
  const status = statusParam === 'streaming' || statusParam === 'unreleased' ? statusParam : 'all'
  const page = Math.max(0, Number(pageParam ?? 0) || 0)

  const supabase = await createClient()
  const { data } = await buildArtistAlbumQuery<AlbumRow>(
    supabase,
    id,
    'id, title, jacket_url, release_date, streaming_status, track_count, label:label_id(name)'
  )

  let albums = (data ?? []).map((a) => ({ ...a, albumType: classifyAlbumType(a.title, a.track_count) }))
  if (type !== 'all') albums = albums.filter((a) => a.albumType === type)
  if (status === 'streaming') albums = albums.filter((a) => !UNRELEASED_VALUES.includes(a.streaming_status ?? ''))
  else if (status === 'unreleased') albums = albums.filter((a) => UNRELEASED_VALUES.includes(a.streaming_status ?? ''))

  const totalCount = albums.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const pageItems = albums.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  return (
    <div>
      <h2 className="text-xs uppercase tracking-wide text-white/40">Discography</h2>
      <div className="mt-3">
        <DiscographyFilters type={type} status={status} />
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
                  {album.release_date ?? ''} · {ALBUM_TYPE_LABEL_JA[album.albumType]}
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
            <Link href={`?${new URLSearchParams({ ...(type !== 'all' && { type }), ...(status !== 'all' && { status }), page: String(page - 1) }).toString()}`}>
              ← 前へ
            </Link>
          )}
          <span>{page + 1} / {totalPages}</span>
          {page + 1 < totalPages && (
            <Link href={`?${new URLSearchParams({ ...(type !== 'all' && { type }), ...(status !== 'all' && { status }), page: String(page + 1) }).toString()}`}>
              次へ →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
