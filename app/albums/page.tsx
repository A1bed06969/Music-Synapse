import { createClient } from '@/utils/Supabase/server'
import AlbumBrowseClient from './AlbumBrowseClient'

const PAGE_SIZE = 1000

type AlbumRow = {
  id: string
  title: string
  title_kana: string | null
  jacket_url: string | null
  release_date: string | null
  streaming_status: string | null
  artist: { name: string } | { name: string }[] | null
}

async function fetchAllAlbums(supabase: Awaited<ReturnType<typeof createClient>>): Promise<AlbumRow[]> {
  // PostgRESTは1回のクエリで最大1000件しか返さないため、アルバム全件(26,000件超)は
  // ページ単位で取得する必要がある。以前はoffsetをずらしながら逐次awaitしており、
  // 27回前後の往復が直列に発生してページ生成が重くなっていた(/artistsで実際に
  // 発生した52秒バグと同じ原因)。まず件数だけ取得してページ数を決め、
  // 各ページを並列に取得することで、往復回数はそのままでも合計の待ち時間を
  // ほぼ1往復分まで縮める。
  const { count } = await supabase
    .from('album')
    .select('id', { count: 'exact', head: true })
    .is('primary_album_id', null)
  const totalCount = count ?? 0
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, i) =>
      supabase
        .from('album')
        .select('id, title, title_kana, jacket_url, release_date, streaming_status, artist:artist_id(name)')
        .is('primary_album_id', null)
        .order('id', { ascending: true })
        .range(i * PAGE_SIZE, i * PAGE_SIZE + PAGE_SIZE - 1)
    )
  )
  return pages.flatMap((p) => (p.data ?? []) as AlbumRow[])
}

export default async function AlbumsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>
}) {
  const { sort } = await searchParams
  const supabase = await createClient()

  const data = await fetchAllAlbums(supabase)

  const albums = data
    .map((a) => {
      const artist = Array.isArray(a.artist) ? a.artist[0] : a.artist
      return {
        id: a.id,
        title: a.title,
        title_kana: a.title_kana,
        jacket_url: a.jacket_url,
        releaseDate: a.release_date,
        streamingStatus: a.streaming_status,
        artistName: artist?.name ?? null,
      }
    })
    .sort((a, b) => (a.title_kana ?? a.title).localeCompare(b.title_kana ?? b.title, 'ja'))

  return <AlbumBrowseClient albums={albums} initialSort={sort === 'release' ? 'release' : 'kana'} />
}
