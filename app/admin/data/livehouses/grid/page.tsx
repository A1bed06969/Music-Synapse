import GridPage from '../../grid/GridPage'

export default async function LivehouseGridPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; preset?: string }>
}) {
  const { q, preset } = await searchParams
  return (
    <GridPage
      tableKey="livehouse"
      scopeId={null}
      title="ライブハウス(表で編集)"
      backHref="/admin/data/livehouses"
      backLabel="ライブハウスに戻る"
      revalidate={['/admin/data/livehouses', '/map']}
      newRowDefaults={{ country: 'JP' }}
      q={q}
      preset={preset}
    />
  )
}
