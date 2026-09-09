import { unstable_cache } from 'next/cache'
import { createClient } from '@/utils/Supabase/server'
import AlbumBrowseClient from './AlbumBrowseClient'

// 以前はアルバム全件(135,937行)を取得してブラウザ側で絞り込んでいたため、
// HTMLが107.9MB・完了まで36秒かかっていた。DB側で絞ってページ単位で返す。
const PAGE_SIZE = 60

const UNRELEASED_VALUES = ['none', 'unreleased']

type AlbumRpcRow = {
  id: string
  title: string
  title_kana: string | null
  jacket_url: string | null
  release_date: string | null
  streaming_status: string | null
  artist_name: string | null
  total_count: number
}

type AlbumTableRow = {
  id: string
  title: string
  title_kana: string | null
  jacket_url: string | null
  release_date: string | null
  streaming_status: string | null
  artist: { name: string } | { name: string }[] | null
}

/** 絞り込み無しのときの総件数。128,739件を毎リクエスト数えると3秒近くかかり
 * statement timeoutに触れるため、10分キャッシュする(表示用の件数なので
 * 多少古くても実害がない)。 */
const getTotalAlbumCount = unstable_cache(
  async (status: string): Promise<number> => {
    const { createClient: createAnonClient } = await import('@supabase/supabase-js')
    const supabase = createAnonClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    let request = supabase
      .from('album')
      .select('id', { count: 'exact', head: true })
      .is('primary_album_id', null)
    if (status === 'unreleased') request = request.in('streaming_status', UNRELEASED_VALUES)
    else if (status === 'streaming') {
      request = request.or(
        `streaming_status.is.null,streaming_status.not.in.(${UNRELEASED_VALUES.join(',')})`
      )
    }
    const { count } = await request
    return count ?? 0
  },
  ['album-total-count'],
  { revalidate: 600 }
)

export default async function AlbumsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; q?: string; status?: string; page?: string }>
}) {
  const params = await searchParams
  const sort = params.sort === 'release' ? 'release' : 'kana'
  const status = params.status === 'streaming' || params.status === 'unreleased' ? params.status : 'all'
  const query = (params.q ?? '').trim()
  const page = Math.max(0, Number(params.page ?? 0) || 0)
  const offset = page * PAGE_SIZE

  const supabase = await createClient()

  let albums: {
    id: string
    title: string
    title_kana: string | null
    jacket_url: string | null
    releaseDate: string | null
    streamingStatus: string | null
    artistName: string | null
  }[] = []
  let totalCount = 0

  if (query) {
    // 検索時は該当件数が少ないため、件数付きのRPC(タイトル・かな・アーティスト名を横断)を使う
    const { data } = await supabase.rpc('browse_albums', {
      p_query: query,
      p_status: status,
      p_sort: sort,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    })
    const rows = (data ?? []) as AlbumRpcRow[]
    totalCount = rows[0]?.total_count ? Number(rows[0].total_count) : 0
    albums = rows.map((a) => ({
      id: a.id,
      title: a.title,
      title_kana: a.title_kana,
      jacket_url: a.jacket_url,
      releaseDate: a.release_date,
      streamingStatus: a.streaming_status,
      artistName: a.artist_name,
    }))
  } else {
    // 絞り込み無しは件数を数えず、並び替えキーのインデックスでページだけ引く
    let request = supabase
      .from('album')
      .select('id, title, title_kana, jacket_url, release_date, streaming_status, artist:artist_id(name)')
      .is('primary_album_id', null)
    if (status === 'unreleased') request = request.in('streaming_status', UNRELEASED_VALUES)
    else if (status === 'streaming') {
      request = request.or(
        `streaming_status.is.null,streaming_status.not.in.(${UNRELEASED_VALUES.join(',')})`
      )
    }
    const [{ data }, count] = await Promise.all([
      sort === 'release'
        ? request.order('release_date', { ascending: false, nullsFirst: false }).range(offset, offset + PAGE_SIZE - 1)
        : request.order('sort_key').range(offset, offset + PAGE_SIZE - 1),
      getTotalAlbumCount(status),
    ])
    totalCount = count
    albums = ((data ?? []) as AlbumTableRow[]).map((a) => {
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
  }

  return (
    <AlbumBrowseClient
      albums={albums}
      sort={sort}
      status={status}
      query={query}
      page={page}
      pageSize={PAGE_SIZE}
      totalCount={totalCount}
    />
  )
}
