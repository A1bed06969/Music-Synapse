'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import SearchableSelect from '../SearchableSelect'
import { searchAlbums, searchArtists, searchTracks } from '../actions'
import { resolveGridPaste, saveGrid } from './actions'
import type { CellValue, ColumnDef, GridRow, GridTarget, TargetKind } from './tables'

const KIND_LABEL: Record<TargetKind, string> = {
  track: '曲',
  album: 'アルバム',
  artist: 'アーティスト',
}
const SEARCH = {
  track: searchTracks,
  album: searchAlbums,
  artist: searchArtists,
}

const cellInput =
  'w-full bg-transparent px-2 py-1.5 text-sm text-white outline-none focus:bg-amber-500/10 focus:ring-1 focus:ring-amber-400/60'

function snapshot(r: GridRow): string {
  return JSON.stringify([r.values, r.target?.kind ?? null, r.target?.id ?? null])
}

export default function DataGrid({
  tableKey,
  scopeId,
  columns,
  initialRows,
  pasteLabels,
  revalidate,
  newRowDefaults = {},
  confirmDeleteMessage,
  allowInsert = true,
  allowDelete = true,
}: {
  tableKey: string
  scopeId: string | null
  columns: ColumnDef[]
  initialRows: GridRow[]
  pasteLabels: string[]
  revalidate: string[]
  newRowDefaults?: Record<string, CellValue>
  confirmDeleteMessage?: string
  allowInsert?: boolean
  allowDelete?: boolean
}) {
  const baseline = useMemo(() => new Map(initialRows.map((r) => [r.key, snapshot(r)])), [initialRows])
  const targetCol = columns.find((c) => c.type === 'target') as Extract<ColumnDef, { type: 'target' }> | undefined
  const [rows, setRows] = useState<GridRow[]>(initialRows)
  const [deleted, setDeleted] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<{
    key: string
    kind: TargetKind
  } | null>(null)
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const [message, setMessage] = useState<string | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [isPending, startTransition] = useTransition()

  const isNew = (r: GridRow) => !r.id
  const isChanged = (r: GridRow) => isNew(r) || baseline.get(r.key) !== snapshot(r)
  const changedCount =
    rows.filter((r) => !deleted.has(r.key) && isChanged(r)).length + [...deleted].filter((k) => baseline.has(k)).length

  const setValue = (key: string, col: string, value: CellValue) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, values: { ...r.values, [col]: value } } : r)))
  const setTarget = (key: string, target: GridTarget) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, target, unresolved: undefined } : r)))

  function toggleDelete(r: GridRow) {
    if (isNew(r)) {
      setRows((prev) => prev.filter((x) => x.key !== r.key))
      return
    }
    setDeleted((prev) => {
      const next = new Set(prev)
      if (next.has(r.key)) next.delete(r.key)
      else next.add(r.key)
      return next
    })
  }

  function addRow() {
    const values: Record<string, CellValue> = {}
    for (const c of columns)
      if (c.type !== 'target' && c.type !== 'link')
        values[c.key] = newRowDefaults[c.key] ?? (c.type === 'checkbox' ? false : '')
    setRows((prev) => [...prev, { key: `new-${Date.now()}`, values, target: null }])
  }

  function handlePaste() {
    const lines = pasteText
      .split(/\r?\n/)
      .map((l) => l.split('\t'))
      .filter((cols) => cols.some((c) => c.trim()))
      .filter((cols) => cols[0]?.trim() !== pasteLabels[0])
    if (lines.length === 0) return
    startTransition(async () => {
      const resolved = await resolveGridPaste(tableKey, lines)
      const withDefaults = resolved.map((r) => ({
        ...r,
        values: Object.fromEntries(
          Object.entries(r.values).map(([k, v]) => [
            k,
            v === '' && newRowDefaults[k] !== undefined ? newRowDefaults[k] : v,
          ]),
        ),
      }))
      setRows((prev) => [...prev, ...withDefaults])
      setPasteText('')
      const unresolved = withDefaults.filter((r) => targetCol && !r.target).length
      setMessage(
        `${withDefaults.length}行を追加しました。${unresolved ? `うち${unresolved}行は照合できませんでした(黄色)。選び直してから保存してください。` : ''}`,
      )
    })
  }

  function handleSave() {
    const live = rows.filter((r) => !deleted.has(r.key))
    const payload = {
      updates: live.filter((r) => !isNew(r) && isChanged(r)),
      inserts: live.filter(isNew),
      deletes: [...deleted].filter((k) => baseline.has(k)),
    }
    if (
      payload.deletes.length > 0 &&
      !window.confirm(
        confirmDeleteMessage?.replace('{n}', String(payload.deletes.length)) ??
          `${payload.deletes.length}行を削除します。元に戻せません。よろしいですか?`,
      )
    ) {
      return
    }
    startTransition(async () => {
      const result = await saveGrid(tableKey, scopeId, payload, revalidate)
      setErrors(new Map(result.errors.map((e) => [e.key, e.message])))
      const rowKeys = new Set(rows.map((r) => r.key))
      const general = result.errors.filter((e) => !rowKeys.has(e.key)).map((e) => e.message)
      setMessage([result.message, ...general].join(' '))
      if (result.success) window.location.reload()
    })
  }

  const q = filter.trim().toLowerCase()
  const visible = q
    ? rows.filter((r) =>
        `${Object.values(r.values).join(' ')} ${r.target?.label ?? ''} ${r.unresolved ?? ''}`.toLowerCase().includes(q),
      )
    : rows

  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="絞り込み"
          className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/40 px-3 py-1.5 text-sm text-white placeholder:text-white/30 sm:max-w-xs"
        />
        <span className="text-xs text-white/40">
          {visible.length} / {rows.length}行
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            disabled={changedCount === 0 || isPending}
            className="rounded-md border border-white/15 px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-30"
          >
            変更を取り消す
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={changedCount === 0 || isPending}
            className="rounded-md bg-amber-400 px-3 py-1.5 text-xs font-medium text-black hover:bg-amber-300 disabled:opacity-30"
          >
            {isPending ? '処理中…' : changedCount ? `保存(${changedCount}件の変更)` : '保存'}
          </button>
        </div>
      </div>

      {message && <p className="border-b border-white/10 px-4 py-2 text-xs text-amber-300">{message}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="bg-white/[0.03] text-left text-[11px] tracking-wide text-white/40">
              {allowDelete && <th className="w-8 px-2 py-2"></th>}
              {columns.map((c) => (
                <th key={c.key} className={`px-2 py-2 ${'width' in c && c.width ? c.width : ''}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const isDeleted = deleted.has(r.key)
              const base = baseline.get(r.key)
              const was = base ? (JSON.parse(base) as [Record<string, CellValue>, string | null, string | null]) : null
              const dirty = (key: string) =>
                !isDeleted &&
                (!was ||
                  (key === 'target'
                    ? was[1] !== (r.target?.kind ?? null) || was[2] !== (r.target?.id ?? null)
                    : was[0][key] !== r.values[key]))
              const cell = (key: string) =>
                `border-b border-white/5 border-r border-r-white/[0.04] p-0 align-top ${dirty(key) ? 'bg-amber-500/[0.07]' : ''}`
              const error = errors.get(r.key)
              return (
                <tr key={r.key} className={isDeleted ? 'opacity-40 line-through' : ''}>
                  {allowDelete && (
                    <td className="border-b border-white/5 px-2 pt-1.5 text-center align-top">
                      <button
                        type="button"
                        onClick={() => toggleDelete(r)}
                        title={isDeleted ? '削除を取り消す' : 'この行を削除'}
                        className="text-white/30 hover:text-red-400"
                      >
                        {isDeleted ? '↺' : '×'}
                      </button>
                    </td>
                  )}
                  {columns.map((c) => {
                    if (c.type === 'target') {
                      return (
                        <td key={c.key} className={cell('target')}>
                          {editing?.key === r.key ? (
                            <div className="space-y-1.5 p-1.5">
                              <div className="flex gap-1">
                                {c.kinds.length > 1 &&
                                  c.kinds.map((k) => (
                                    <button
                                      key={k}
                                      type="button"
                                      onClick={() => setEditing({ key: r.key, kind: k })}
                                      className={`rounded px-2 py-0.5 text-[11px] ${editing.kind === k ? 'bg-amber-400 text-black' : 'text-white/50 hover:bg-white/5'}`}
                                    >
                                      {KIND_LABEL[k]}
                                    </button>
                                  ))}
                                <button
                                  type="button"
                                  onClick={() => setEditing(null)}
                                  className="ml-auto px-2 text-[11px] text-white/40 hover:text-white"
                                >
                                  閉じる
                                </button>
                              </div>
                              <SearchableSelect
                                key={editing.kind}
                                searchAction={SEARCH[editing.kind]}
                                name={`target-${r.key}`}
                                placeholder={
                                  editing.kind === 'track'
                                    ? '曲名(「曲名 アーティスト名」も可)'
                                    : `${KIND_LABEL[editing.kind]}を検索`
                                }
                                inlineResults
                                onSelect={(item) => {
                                  if (!item) return
                                  setTarget(r.key, {
                                    kind: editing.kind,
                                    id: item.id,
                                    label: item.label,
                                  })
                                  setEditing(null)
                                }}
                              />
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setEditing({
                                  key: r.key,
                                  kind: r.target?.kind ?? c.kinds[0],
                                })
                              }
                              className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-white/5"
                            >
                              {r.target ? (
                                <>
                                  {c.kinds.length > 1 && (
                                    <span className="shrink-0 rounded bg-white/10 px-1.5 text-[10px] text-white/60">
                                      {KIND_LABEL[r.target.kind]}
                                    </span>
                                  )}
                                  <span className="truncate">{r.target.label}</span>
                                </>
                              ) : (
                                <span className="truncate text-amber-300">
                                  {r.unresolved ? `未照合: ${r.unresolved}(クリックして選ぶ)` : 'クリックして選ぶ'}
                                </span>
                              )}
                            </button>
                          )}
                          {error && <p className="px-2 pb-1 text-[11px] text-red-400">{error}</p>}
                        </td>
                      )
                    }
                    if (c.type === 'link') {
                      return (
                        <td key={c.key} className="border-b border-white/5 px-2 py-1.5 align-top whitespace-nowrap">
                          {r.id ? (
                            <Link
                              href={c.href.replace('{id}', r.id)}
                              className="text-xs text-amber-300 hover:text-amber-200"
                            >
                              {c.text}
                            </Link>
                          ) : (
                            <span className="text-[11px] text-white/30">保存後に開けます</span>
                          )}
                        </td>
                      )
                    }
                    const v = r.values[c.key]
                    return (
                      <td key={c.key} className={cell(c.key)}>
                        {c.type === 'select' ? (
                          <select
                            value={String(v ?? '')}
                            onChange={(e) => setValue(r.key, c.key, e.target.value)}
                            className={cellInput}
                          >
                            <option value="">—</option>
                            {(c.options ?? []).map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : c.type === 'checkbox' ? (
                          <label className="flex justify-center py-1.5">
                            <input
                              type="checkbox"
                              checked={Boolean(v)}
                              onChange={(e) => setValue(r.key, c.key, e.target.checked)}
                              className="h-4 w-4 accent-amber-400"
                            />
                          </label>
                        ) : (
                          <input
                            type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
                            value={v === null || v === undefined ? '' : String(v)}
                            onChange={(e) => setValue(r.key, c.key, e.target.value)}
                            className={`${cellInput} ${c.type !== 'text' ? 'font-mono tabular-nums' : ''}`}
                          />
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {allowInsert && (
        <div className="flex flex-wrap items-start gap-3 border-t border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={addRow}
            className="rounded-md border border-white/15 px-3 py-1.5 text-xs hover:bg-white/5"
          >
            + 行を追加
          </button>
          <div className="min-w-0 flex-1">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={3}
              placeholder={`Excelから貼り付け(列: ${pasteLabels.join(' / ')})`}
              className="w-full rounded-md border border-dashed border-white/15 bg-black/40 px-3 py-2 font-mono text-xs text-white placeholder:text-white/25"
            />
            <div className="mt-1 flex items-center gap-3">
              <button
                type="button"
                onClick={handlePaste}
                disabled={!pasteText.trim() || isPending}
                className="rounded-md border border-white/15 px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-30"
              >
                貼り付けた行を追加
              </button>
              <span className="text-[11px] text-white/35">
                タイトルとアーティスト名で照合します。アーティストだけを選ぶ行はタイトルを空欄にしてください。
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
