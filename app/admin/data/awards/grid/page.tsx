import GridPage from '../../grid/GridPage'

export default async function AwardListGridPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; preset?: string }>
}) {
  const { q, preset } = await searchParams
  return (
    <GridPage
      tableKey="awardList"
      scopeId={null}
      title="アワード(表で編集)"
      backHref="/admin/data/awards"
      backLabel="アワードに戻る"
      revalidate={['/admin/data/awards']}
      q={q}
      preset={preset}
    />
  )
}
