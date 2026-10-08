import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import GridPage from '../../../grid/GridPage'

function currentYear(): number {
  return new Date().getFullYear()
}

export default async function AwardGridPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: award } = await supabase.from('award').select('id, name').eq('id', id).maybeSingle()
  if (!award) notFound()
  return (
    <GridPage
      tableKey="award"
      scopeId={id}
      title={`${award.name}(表で編集)`}
      backHref="/admin/data/awards"
      backLabel="アワードに戻る"
      revalidate={['/admin/data/awards', `/awards/${id}`]}
      newRowDefaults={{ year: currentYear(), result: 'winner' }}
    />
  )
}
