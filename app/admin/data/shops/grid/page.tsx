import GridPage from '../../grid/GridPage'

export default async function RecordshopGridPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; preset?: string }>
}) {
  const { q, preset } = await searchParams
  return (
    <GridPage
      tableKey="recordshop"
      scopeId={null}
      title="レコードショップ(表で編集)"
      backHref="/admin/data/shops"
      backLabel="レコードショップに戻る"
      revalidate={['/admin/data/shops', '/map']}
      newRowDefaults={{ country: 'JP' }}
      q={q}
      preset={preset}
    />
  )
}
