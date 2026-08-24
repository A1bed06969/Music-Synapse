import { createClient } from '@/utils/Supabase/server'
import { getDescendantGenreIds, type LineageEdge } from '@/utils/genreHistory'
import GenreListClient from './GenreListClient'

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function GenresPage() {
  const supabase = await createClient()

  const [{ data: genresWithYear }, { data: lineageRows }] = await Promise.all([
    supabase.from('genre').select('id, name, origin_year, origin_year_label, origin_country').not('origin_year', 'is', null),
    supabase.from('genre_lineage').select('parent_genre_id, child_genre_id, relation_type'),
  ])

  const childIds = new Set((lineageRows ?? []).map((r) => r.child_genre_id))
  const parentIds = new Set((lineageRows ?? []).map((r) => r.parent_genre_id))

  // "jazz"のように自分自身はorigin_year未設定(=自分専用のERAカードを持たない)but
  // 子ジャンルを持つルートは、メインジャンルの入口として一覧に出す必要があるため、
  // origin_yearの有無に関わらず個別に取得する
  const includedIds = new Set((genresWithYear ?? []).map((g) => g.id))
  const missingRootIds = [...parentIds].filter((id) => !childIds.has(id) && !includedIds.has(id))

  let extraRoots: typeof genresWithYear = []
  if (missingRootIds.length > 0) {
    const { data } = await supabase
      .from('genre')
      .select('id, name, origin_year, origin_year_label, origin_country')
      .in('id', missingRootIds)
    extraRoots = data ?? []
  }

  const genres = [...(genresWithYear ?? []), ...extraRoots]
    .map((g) => ({ ...g, isSub: childIds.has(g.id) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // メインジャンル(親を持たないジャンル)はサムネイル付きカードで表示するため、
  // それぞれの子孫の中から代表画像(アーティスト画像優先、無ければアルバムジャケット)を1枚探す
  const mainGenres = genres.filter((g) => !g.isSub)
  const imageByMainGenreId = new Map<string, string>()

  if (mainGenres.length > 0) {
    const edges: LineageEdge[] = (lineageRows ?? []).map((r) => ({
      parentGenreId: r.parent_genre_id,
      childGenreId: r.child_genre_id,
      relationType: (r.relation_type as LineageEdge['relationType']) ?? 'derivation',
    }))

    const descendantsByMainId = new Map(mainGenres.map((g) => [g.id, getDescendantGenreIds(g.id, edges)]))
    const allDescendantIds = [...new Set([...descendantsByMainId.values()].flat())]

    const { data: highlightRows } = await supabase
      .from('genre_highlight')
      .select('id, genre_id, artist:artist_id(image_url), album:album_id(jacket_url)')
      .in('genre_id', allDescendantIds)
      .order('id')

    const imageByGenreId = new Map<string, string>()
    for (const h of highlightRows ?? []) {
      if (imageByGenreId.has(h.genre_id)) continue
      const artist = firstOf(h.artist)
      const album = firstOf(h.album)
      const url = artist?.image_url ?? album?.jacket_url ?? null
      if (url) imageByGenreId.set(h.genre_id, url)
    }

    for (const g of mainGenres) {
      const descendantIds = descendantsByMainId.get(g.id) ?? []
      const url = descendantIds.map((id) => imageByGenreId.get(id)).find((u) => u !== undefined)
      if (url) imageByMainGenreId.set(g.id, url)
    }
  }

  const genresWithImage = genres.map((g) => ({ ...g, imageUrl: imageByMainGenreId.get(g.id) ?? null }))

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">ジャンル年表</h1>
      <p className="mt-2 text-sm text-white/50">
        ジャンルを選ぶと、発祥・サブジャンル・代表アーティストを時系列で並べた年表を見られます。
      </p>
      <GenreListClient genres={genresWithImage} />
    </div>
  )
}
