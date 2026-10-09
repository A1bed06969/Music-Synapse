import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import GridPage from '../../../../grid/GridPage'

function currentYear(): number {
  return new Date().getFullYear()
}

export default async function FestivalEditionGridPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: event } = await supabase.from('event').select('id, name').eq('id', id).maybeSingle()
  if (!event) notFound()
  return (
    <GridPage
      tableKey="festivalEdition"
      scopeId={id}
      title={`${event.name}(開催回を表で編集)`}
      backHref={`/admin/data/events/event/${id}/edit`}
      backLabel="フェスの編集に戻る"
      revalidate={['/admin/data/events', `/events/${id}`]}
      newRowDefaults={{ year: currentYear() }}
    />
  )
}
