import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import GridPage from '../../../grid/GridPage'

function todayJst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
}

export default async function RankingGridPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: ranking } = await supabase.from('ranking').select('id, name').eq('id', id).maybeSingle()
  if (!ranking) notFound()
  return (
    <GridPage
      tableKey="ranking"
      scopeId={id}
      title={`${ranking.name}(表で編集)`}
      backHref="/admin/data/curation"
      backLabel="キュレーション・ランキングに戻る"
      revalidate={['/admin/data/curation', `/curation/${id}`, `/rankings/${id}`]}
      newRowDefaults={{ period_date: todayJst() }}
    />
  )
}
