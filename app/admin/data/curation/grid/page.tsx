import GridPage from '../../grid/GridPage'

export default async function RankingListGridPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; preset?: string }>
}) {
  const { q, preset } = await searchParams
  return (
    <GridPage
      tableKey="rankingList"
      scopeId={null}
      title="キュレーション・ランキング企画(表で編集)"
      backHref="/admin/data/curation"
      backLabel="キュレーションコンテンツに戻る"
      revalidate={['/admin/data/curation']}
      newRowDefaults={{ list_type: 'selection' }}
      q={q}
      preset={preset}
    />
  )
}
