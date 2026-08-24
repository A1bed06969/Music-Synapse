import { createClient } from '@/utils/Supabase/server'
import GenreListClient from './GenreListClient'

export default async function GenresPage() {
  const supabase = await createClient()

  const { data: genres } = await supabase
    .from('genre')
    .select('id, name, origin_year, origin_year_label, origin_country')
    .not('origin_year', 'is', null)
    .order('name')

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">ジャンル年表</h1>
      <p className="mt-2 text-sm text-white/50">
        ジャンルを選ぶと、発祥・サブジャンル・代表アーティストを時系列で並べた年表を見られます。
      </p>
      <GenreListClient genres={genres ?? []} />
    </div>
  )
}
