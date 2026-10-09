import GridPage from '../../grid/GridPage'

export default async function AlbumGridPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; preset?: string }>
}) {
  const { q, preset } = await searchParams
  return (
    <GridPage
      tableKey="album"
      scopeId={null}
      title="アルバム(表で編集)"
      backHref="/admin/data"
      backLabel="管理画面に戻る"
      revalidate={['/admin/data']}
      q={q}
      preset={preset}
    />
  )
}
