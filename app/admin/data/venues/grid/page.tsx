import GridPage from '../../grid/GridPage'

export default async function VenueGridPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; preset?: string }>
}) {
  const { q, preset } = await searchParams
  return (
    <GridPage
      tableKey="venue"
      scopeId={null}
      title="会場の座標(表で編集)"
      backHref="/admin/data/venues"
      backLabel="会場の座標登録に戻る"
      revalidate={['/admin/data/venues', '/map']}
      q={q}
      preset={preset}
    />
  )
}
