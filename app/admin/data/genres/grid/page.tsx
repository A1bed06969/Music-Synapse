import GridPage from '../../grid/GridPage'

export default async function GenreGridPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; preset?: string }>
}) {
  const { q, preset } = await searchParams
  return (
    <GridPage
      tableKey="genre"
      scopeId={null}
      title="ジャンル(表で編集)"
      backHref="/admin/data/genres"
      backLabel="ジャンルに戻る"
      revalidate={['/admin/data/genres', '/genres']}
      q={q}
      preset={preset}
    />
  )
}
