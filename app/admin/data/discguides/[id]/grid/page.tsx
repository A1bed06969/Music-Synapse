import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import GridPage from '../../../grid/GridPage'

export default async function DiscGuideGridPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: guide } = await supabase.from('disc_guide').select('id, title').eq('id', id).maybeSingle()
  if (!guide) notFound()
  return (
    <GridPage
      tableKey="discguide"
      scopeId={id}
      title={`${guide.title}(掲載作品を表で編集)`}
      backHref="/admin/data/discguides"
      backLabel="ディスクガイドに戻る"
      revalidate={['/admin/data/discguides', `/disc-guides/${id}`]}
    />
  )
}
