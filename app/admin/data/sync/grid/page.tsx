import GridPage from '../../grid/GridPage'

export default async function SyncworkGridPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; preset?: string }>
}) {
  const { q, preset } = await searchParams
  return (
    <GridPage
      tableKey="syncWork"
      scopeId={null}
      title="タイアップ作品(表で編集)"
      backHref="/admin/data/sync"
      backLabel="タイアップ・シンクロアーカイブに戻る"
      revalidate={['/admin/data/sync']}
      q={q}
      preset={preset}
    />
  )
}
