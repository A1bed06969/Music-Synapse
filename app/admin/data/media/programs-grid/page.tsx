import GridPage from '../../grid/GridPage'

export default async function ProgramGridPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; preset?: string }>
}) {
  const { q, preset } = await searchParams
  return (
    <GridPage
      tableKey="program"
      scopeId={null}
      title="番組(表で編集)"
      backHref="/admin/data/media"
      backLabel="メディア&オンエアに戻る"
      revalidate={['/admin/data/media', '/media/on-air']}
      newRowDefaults={{ period_type: 'monthly' }}
      q={q}
      preset={preset}
    />
  )
}
