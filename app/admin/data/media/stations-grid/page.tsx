import GridPage from '../../grid/GridPage'

export default async function StationGridPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; preset?: string }>
}) {
  const { q, preset } = await searchParams
  return (
    <GridPage
      tableKey="station"
      scopeId={null}
      title="ラジオ局(表で編集)"
      backHref="/admin/data/media"
      backLabel="メディア&オンエアに戻る"
      revalidate={['/admin/data/media', '/media/on-air']}
      newRowDefaults={{ media_type: 'radio' }}
      q={q}
      preset={preset}
    />
  )
}
