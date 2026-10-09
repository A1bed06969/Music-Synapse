import GridPage from '../../grid/GridPage'

export default async function LabelGridPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; preset?: string }>
}) {
  const { q, preset } = await searchParams
  return (
    <GridPage
      tableKey="label"
      scopeId={null}
      title="レーベル(表で編集)"
      backHref="/admin/data/labels"
      backLabel="レーベルに戻る"
      revalidate={['/admin/data/labels', '/labels']}
      q={q}
      preset={preset}
    />
  )
}
