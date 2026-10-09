import GridPage from '../../grid/GridPage'

export default async function FestivalListGridPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; preset?: string }>
}) {
  const { q, preset } = await searchParams
  return (
    <GridPage
      tableKey="festivalList"
      scopeId={null}
      title="フェス・イベント(表で編集)"
      backHref="/admin/data/events"
      backLabel="イベントに戻る"
      revalidate={['/admin/data/events']}
      newRowDefaults={{ event_type: 'festival' }}
      q={q}
      preset={preset}
    />
  )
}
