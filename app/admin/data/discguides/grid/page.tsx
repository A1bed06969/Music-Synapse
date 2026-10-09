import GridPage from '../../grid/GridPage'

export default async function DiscGuideListGridPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; preset?: string }>
}) {
  const { q, preset } = await searchParams
  return (
    <GridPage
      tableKey="discGuideList"
      scopeId={null}
      title="ディスクガイド(表で編集)"
      backHref="/admin/data/discguides"
      backLabel="ディスクガイドに戻る"
      revalidate={['/admin/data/discguides']}
      q={q}
      preset={preset}
    />
  )
}
