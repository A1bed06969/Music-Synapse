import Link from 'next/link'
import DataGrid from './DataGrid'
import { getTableConfig, loadGridRows, type CellValue, type GridTableKey } from './tables'
import { pasteColumnLabels } from './actions'

/** 共通の表編集ページの枠。各コンテンツのページはこれに見出しと対象IDを渡すだけ */
export default async function GridPage({
  tableKey,
  scopeId,
  title,
  backHref,
  backLabel,
  revalidate,
  newRowDefaults,
  confirmDeleteMessage,
}: {
  tableKey: GridTableKey
  scopeId: string
  title: string
  backHref: string
  backLabel: string
  revalidate: string[]
  newRowDefaults?: Record<string, CellValue>
  confirmDeleteMessage?: string
}) {
  const config = getTableConfig(tableKey)
  const [rows, pasteLabels] = await Promise.all([loadGridRows(tableKey, scopeId), pasteColumnLabels(tableKey)])
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href={backHref} className="text-xs text-white/40 hover:text-white/70">
        ← {backLabel}
      </Link>
      <h1 className="mt-4 text-2xl font-bold">{title}</h1>
      <p className="mt-1 text-sm text-white/50">
        セルを直接書き換えて「保存」でまとめて反映します。Excelやスプレッドシートからコピーした行は、下の欄に貼り付けると新しい行として追加されます。
      </p>
      <DataGrid
        tableKey={tableKey}
        scopeId={scopeId}
        columns={config.columns}
        initialRows={rows}
        pasteLabels={pasteLabels}
        revalidate={revalidate}
        newRowDefaults={newRowDefaults}
        confirmDeleteMessage={confirmDeleteMessage}
      />
    </div>
  )
}
