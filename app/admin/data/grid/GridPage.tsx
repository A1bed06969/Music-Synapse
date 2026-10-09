import Link from 'next/link'
import DataGrid from './DataGrid'
import { getTableConfig, loadGridRows, resolveColumns, type CellValue, type GridTableKey } from './tables'
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
  q,
  preset,
}: {
  tableKey: GridTableKey
  /** 親のID(このランキング等)。テーブル全体を扱う表ではnull */
  scopeId: string | null
  title: string
  backHref: string
  backLabel: string
  revalidate: string[]
  newRowDefaults?: Record<string, CellValue>
  confirmDeleteMessage?: string
  q?: string
  preset?: string
}) {
  const config = getTableConfig(tableKey)
  const [{ rows, truncated }, pasteLabels, columns] = await Promise.all([
    loadGridRows(tableKey, scopeId, { q, preset }),
    pasteColumnLabels(tableKey),
    resolveColumns(config),
  ])
  const presetHref = (key?: string) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (key) params.set('preset', key)
    const s = params.toString()
    return s ? `?${s}` : '?'
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href={backHref} className="text-xs text-white/40 hover:text-white/70">
        ← {backLabel}
      </Link>
      <h1 className="mt-4 text-2xl font-bold">{title}</h1>
      <p className="mt-1 text-sm text-white/50">
        セルを直接書き換えて「保存」でまとめて反映します。
        {config.allowInsert !== false &&
          'Excelやスプレッドシートからコピーした行は、下の欄に貼り付けると新しい行として追加されます。'}
      </p>
      {config.note && (
        <p className="mt-2 border-l-2 border-amber-400/50 pl-3 text-xs text-white/55">{config.note}</p>
      )}

      {config.search && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <form className="flex min-w-0 flex-1 gap-2 sm:max-w-md">
            <input
              name="q"
              defaultValue={q ?? ''}
              placeholder={config.search.placeholder}
              className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/40 px-3 py-1.5 text-sm text-white placeholder:text-white/30"
            />
            {preset && <input type="hidden" name="preset" value={preset} />}
            <button type="submit" className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-white/85">
              検索
            </button>
          </form>
          {config.presets && (
            <div className="flex flex-wrap gap-1.5">
              <Link
                href={presetHref()}
                className={`rounded-full border px-2.5 py-1 text-xs ${!preset ? 'border-amber-400 text-white' : 'border-white/15 text-white/55 hover:text-white'}`}
              >
                すべて
              </Link>
              {config.presets.map((p) => (
                <Link
                  key={p.key}
                  href={presetHref(p.key)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${preset === p.key ? 'border-amber-400 text-white' : 'border-white/15 text-white/55 hover:text-white'}`}
                >
                  {p.label}
                </Link>
              ))}
            </div>
          )}
          {truncated && (
            <p className="w-full text-xs text-amber-300/80">
              該当が多いため上位{config.search.limit}件だけを表示しています。検索や絞り込みで対象を絞ってください。
            </p>
          )}
        </div>
      )}

      <DataGrid
        key={`${q ?? ''}|${preset ?? ''}`}
        tableKey={tableKey}
        scopeId={scopeId}
        columns={columns}
        initialRows={rows}
        pasteLabels={pasteLabels}
        revalidate={revalidate}
        newRowDefaults={newRowDefaults}
        confirmDeleteMessage={confirmDeleteMessage}
        allowInsert={config.allowInsert !== false}
        allowDelete={config.allowDelete !== false}
      />
    </div>
  )
}
