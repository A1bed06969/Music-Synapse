import GridPage from '../../../grid/GridPage'

export default async function MusiceventGridPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; preset?: string }>
}) {
  const { q, preset } = await searchParams
  return (
    <GridPage
      tableKey="musicEvent"
      scopeId={null}
      title="単独公演(表で編集)"
      backHref="/admin/data/events"
      backLabel="イベントに戻る"
      revalidate={['/admin/data/events']}
      q={q}
      preset={preset}
    />
  )
}
