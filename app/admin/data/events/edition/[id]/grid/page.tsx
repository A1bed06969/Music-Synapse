import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import GridPage from '../../../../grid/GridPage'

export default async function FestivalLineupGridPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: edition } = await supabase
    .from('event_edition')
    .select('id, year, event_id, event:event_id(name)')
    .eq('id', id)
    .maybeSingle()
  if (!edition) notFound()
  const event = Array.isArray(edition.event) ? edition.event[0] : edition.event
  return (
    <GridPage
      tableKey="festival"
      scopeId={id}
      title={`${event?.name ?? ''} ${edition.year}(出演者を表で編集)`}
      backHref={`/admin/data/events/event/${edition.event_id}/edit`}
      backLabel="フェスの編集に戻る"
      revalidate={['/admin/data/events', `/events/${edition.event_id}`]}
      newRowDefaults={{ is_headliner: false }}
      confirmDeleteMessage="{n}組の出演を削除します。共演者として紐付いたアーティストの出演情報も一緒に消え、元に戻せません。よろしいですか?"
    />
  )
}
