import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'

export default async function DiscGuideDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: guide, error } = await supabase
    .from('disc_guide')
    .select('id, title, publisher, published_year, isbn, cover_image_url, tower_url')
    .eq('id', id)
    .single()

  if (error || !guide) {
    notFound()
  }

  const { data: selections } = await supabase
    .from('disc_guide_selection')
    .select('id, note, album:album_id(id, title, jacket_url, artist:artist_id(id, name))')
    .eq('disc_guide_id', id)

  type AlbumRow = { id: string; title: string; jacket_url: string | null; artistId: string | null; artistName: string | null }

  const albums: (AlbumRow & { selectionId: string; note: string | null })[] = (selections ?? [])
    .map((row) => {
      const album = Array.isArray(row.album) ? row.album[0] : row.album
      if (!album) return null
      const artist = Array.isArray(album.artist) ? album.artist[0] : album.artist
      return {
        selectionId: row.id,
        note: row.note,
        id: album.id,
        title: album.title,
        jacket_url: album.jacket_url,
        artistId: artist?.id ?? null,
        artistName: artist?.name ?? null,
      }
    })
    .filter((row): row is AlbumRow & { selectionId: string; note: string | null } => row !== null)
    .sort((a, b) => a.title.localeCompare(b.title, 'ja'))

  const meta = [guide.publisher, guide.published_year ? `${guide.published_year}年` : null, guide.isbn]
    .filter(Boolean)
    .join(' / ')

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/discguides" className="text-xs text-white/40 hover:text-white/70">
        ← ディスクガイド一覧
      </Link>

      <div className="mt-4 flex flex-col gap-6 sm:flex-row">
        <div className="w-40 shrink-0">
          <div className="aspect-[3/4] overflow-hidden rounded-md border border-white/10 bg-white/5">
            {guide.cover_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={guide.cover_image_url} alt={guide.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-3xl">📚</div>
            )}
          </div>
          {guide.tower_url && (
            <a
              href={guide.tower_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="https://tower.jp/favicon.ico" alt="" className="h-3.5 w-3.5" />
              TOWER RECORDS ONLINEで確認 →
            </a>
          )}
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{guide.title}</h1>
          {meta && <p className="mt-2 text-sm text-white/50">{meta}</p>}
        </div>
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">掲載アルバム({albums.length}件)</h2>
        {albums.length === 0 ? (
          <p className="mt-4 text-sm text-white/40">掲載アルバムが登録されていません。</p>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {albums.map((album) => (
              <li key={album.selectionId}>
                <Link href={`/albums/${album.id}`} className="group block">
                  <div className="aspect-square overflow-hidden rounded-md bg-white/5">
                    {album.jacket_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={album.jacket_url}
                        alt={album.title}
                        className="h-full w-full object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-2xl">💿</div>
                    )}
                  </div>
                  <p className="mt-2 truncate text-sm font-medium group-hover:opacity-70">{album.title}</p>
                  <p className="truncate text-xs text-white/40">
                    {album.artistName}
                    {album.note ? ` ・ ${album.note}` : ''}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
