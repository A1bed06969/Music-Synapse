import { createClient } from '@/utils/Supabase/server'
import GenreListClient from './GenreListClient'

export default async function GenresPage() {
  const supabase = await createClient()

  const [{ data: genresWithYear }, { data: lineageRows }] = await Promise.all([
    supabase.from('genre').select('id, name, origin_year, origin_year_label, origin_country').not('origin_year', 'is', null),
    supabase.from('genre_lineage').select('parent_genre_id, child_genre_id'),
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

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">ジャンル年表</h1>
      <p className="mt-2 text-sm text-white/50">
        ジャンルを選ぶと、発祥・サブジャンル・代表アーティストを時系列で並べた年表を見られます。
      </p>
      <GenreListClient genres={genres} />
    </div>
  )
}
