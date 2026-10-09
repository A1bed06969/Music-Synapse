import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import GridPage from '../../../../grid/GridPage'

export default async function SyncEntryGridPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: work } = await supabase.from('sync_work').select('id, title').eq('id', id).maybeSingle()
  if (!work) notFound()
  return (
    <GridPage
      tableKey="syncEntry"
      scopeId={id}
      title={`${work.title}(起用曲を表で編集)`}
      backHref="/admin/data/sync"
      backLabel="タイアップ・シンクロアーカイブに戻る"
      revalidate={['/admin/data/sync']}
    />
  )
}
