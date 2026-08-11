import { createClient } from '@/utils/Supabase/server'
import AlbumBrowseClient from './AlbumBrowseClient'

const PAGE_SIZE = 1000

type AlbumRow = {
  id: string
  title: string
  title_kana: string | null
  jacket_url: string | null
  artist: { name: string } | { name: string }[] | null
}

async function fetchAllAlbums(supabase: Awaited<ReturnType<typeof createClient>>): Promise<AlbumRow[]> {
  const rows: AlbumRow[] = []
  let offset = 0
  // PostgRESTは1回のクエリで最大1000件しか返さないため、アルバム全件(1000件超)を
  // 取得するにはoffsetをずらしながらページ単位で取得する必要がある。
  while (true) {
    const { data } = await supabase
      .from('album')
      .select('id, title, title_kana, jacket_url, artist:artist_id(name)')
      .range(offset, offset + PAGE_SIZE - 1)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return rows
}

export default async function AlbumsPage() {
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
        artistName: artist?.name ?? null,
      }
    })
    .sort((a, b) => (a.title_kana ?? a.title).localeCompare(b.title_kana ?? b.title, 'ja'))

  return <AlbumBrowseClient albums={albums} />
}
