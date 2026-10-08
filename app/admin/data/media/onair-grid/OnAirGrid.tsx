'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import SearchableSelect from '../../SearchableSelect'
import { searchAlbums, searchArtists, searchTracks } from '../../actions'
import { resolvePastedRows, saveOnAirGrid, type GridRow, type GridTarget } from './actions'

type ProgramGroup = { region: string; programs: { id: string; label: string }[] }

const PERIODS = [
  { value: 'monthly', label: '月間' },
  { value: 'weekly', label: '週間' },
]
const MUSIC_TYPES = [
  { value: 'DOMESTIC', label: '邦楽' },
  { value: 'OVERSEAS', label: '洋楽' },
]
const TARGET_KINDS: { value: GridTarget['kind']; label: string }[] = [
  { value: 'track', label: '曲' },
  { value: 'album', label: 'アルバム' },
  { value: 'artist', label: 'アーティスト' },
]
const SEARCH = { track: searchTracks, album: searchAlbums, artist: searchArtists }

const cellInput =
  'w-full bg-transparent px-2 py-1.5 text-sm text-white outline-none focus:bg-amber-500/10 focus:ring-1 focus:ring-amber-400/60'

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function snapshot(r: GridRow): string {
  return JSON.stringify([r.media_program_id, r.period_type, r.period_start_date, r.music_type, r.note, r.target?.kind, r.target?.id])
}

export default function OnAirGrid({
  month,
  initialRows,
  programGroups,
}: {
  month: string
  initialRows: GridRow[]
  programGroups: ProgramGroup[]
}) {
  const baseline = useMemo(() => new Map(initialRows.map((r) => [r.key, snapshot(r)])), [initialRows])
  const programLabel = useMemo(
    () => new Map(programGroups.flatMap((g) => g.programs).map((p) => [p.id, p.label])),
    [programGroups]
  )
  const [rows, setRows] = useState<GridRow[]>(initialRows)
  const [deleted, setDeleted] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [editingTarget, setEditingTarget] = useState<{ key: string; kind: GridTarget['kind'] } | null>(null)
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const [message, setMessage] = useState<string | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [isPending, startTransition] = useTransition()

  const isNew = (r: GridRow) => !r.id
  const isChanged = (r: GridRow) => isNew(r) || baseline.get(r.key) !== snapshot(r)
  const changedCount = rows.filter((r) => !deleted.has(r.key) && isChanged(r)).length + [...deleted].filter((k) => baseline.has(k)).length

  function update(key: string, patch: Partial<GridRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

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

  function addEmptyRow() {
    const last = rows[rows.length - 1]
    setRows((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}`,
        media_program_id: last?.media_program_id ?? '',
        period_type: last?.period_type ?? 'monthly',
        period_start_date: last?.period_start_date ?? `${month}-01`,
        music_type: last?.music_type ?? 'DOMESTIC',
        note: '',
        target: null,
      },
    ])
  }

  function handlePaste() {
    const lines = pasteText
      .split(/\r?\n/)
      .map((l) => l.split('\t'))
      .filter((cols) => cols.some((c) => c.trim()))
      // 表の見出し行をそのままコピーした場合は除く
      .filter((cols) => cols[0]?.trim() !== '局')
    if (lines.length === 0) return
    startTransition(async () => {
      const resolved = await resolvePastedRows(lines)
      setRows((prev) => [...prev, ...resolved])
      setPasteText('')
      const unresolved = resolved.filter((r) => !r.target || !r.media_program_id).length
      setMessage(
        `${resolved.length}行を追加しました。${unresolved ? `うち${unresolved}行は照合できなかった欄があります(黄色)。選び直してから保存してください。` : ''}`
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
        `${payload.deletes.length}行を削除します。元になった選出データ(HRPP等)も一緒に消え、元に戻せません。よろしいですか?`
      )
    ) {
      return
    }
    startTransition(async () => {
      const result = await saveOnAirGrid(payload)
      setErrors(new Map(result.errors.map((e) => [e.key, e.message])))
      // 行に紐付かないエラー(削除の失敗など)はメッセージ欄に出す
      const rowKeys = new Set(rows.map((r) => r.key))
      const general = result.errors.filter((e) => !rowKeys.has(e.key)).map((e) => e.message)
      setMessage([result.message, ...general].join(' '))
      // 保存できた場合は最新の状態(新規行のID等)で表を作り直す
      if (result.success) window.location.reload()
    })
  }

  const q = filter.trim().toLowerCase()
  const visible = q
    ? rows.filter((r) =>
        `${programLabel.get(r.media_program_id) ?? ''} ${r.target?.label ?? ''} ${r.note} ${r.unresolved ?? ''}`
          .toLowerCase()
          .includes(q)
      )
    : rows

  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <Link href={`?month=${shiftMonth(month, -1)}`} className="rounded px-2 py-1 text-white/50 hover:bg-white/5">
            ←
          </Link>
          <span className="font-mono tabular-nums">{month.replace('-', '年')}月</span>
          <Link href={`?month=${shiftMonth(month, 1)}`} className="rounded px-2 py-1 text-white/50 hover:bg-white/5">
            →
          </Link>
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="局・番組・曲・アーティストで絞り込み"
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
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead>
            <tr className="bg-white/[0.03] text-left text-[11px] tracking-wide text-white/40">
              <th className="w-8 px-2 py-2"></th>
              <th className="px-2 py-2">局 — 番組</th>
              <th className="w-24 px-2 py-2">周期</th>
              <th className="w-36 px-2 py-2">開始日</th>
              <th className="w-20 px-2 py-2">区分</th>
              <th className="px-2 py-2">曲・アルバム・アーティスト</th>
              <th className="w-48 px-2 py-2">メモ</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const isDeleted = deleted.has(r.key)
              const changed = !isDeleted && isChanged(r)
              const error = errors.get(r.key)
              const cellClass = (dirty: boolean) =>
                `border-b border-white/5 border-r border-r-white/[0.04] p-0 ${dirty ? 'bg-amber-500/[0.07]' : ''}`
              const base = baseline.get(r.key)
              const was = base ? (JSON.parse(base) as unknown[]) : null
              const dirtyAt = (i: number, v: unknown) => !was || was[i] !== v
              return (
                <tr key={r.key} className={isDeleted ? 'opacity-40 line-through' : ''}>
                  <td className="border-b border-white/5 px-2 text-center">
                    <button
                      type="button"
                      onClick={() => toggleDelete(r)}
                      title={isDeleted ? '削除を取り消す' : 'この行を削除'}
                      className="text-white/30 hover:text-red-400"
                    >
                      {isDeleted ? '↺' : '×'}
                    </button>
                  </td>
                  <td className={cellClass(changed && dirtyAt(0, r.media_program_id))}>
                    <select
                      value={r.media_program_id}
                      onChange={(e) => update(r.key, { media_program_id: e.target.value, unresolvedProgram: undefined })}
                      className={`${cellInput} ${!r.media_program_id ? 'text-amber-300' : ''}`}
                    >
                      <option value="">{r.unresolvedProgram ? `未照合: ${r.unresolvedProgram}` : '番組を選択'}</option>
                      {programGroups.map((g) => (
                        <optgroup key={g.region} label={g.region}>
                          {g.programs.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td className={cellClass(changed && dirtyAt(1, r.period_type))}>
                    <select value={r.period_type} onChange={(e) => update(r.key, { period_type: e.target.value })} className={cellInput}>
                      <option value="">—</option>
                      {PERIODS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={cellClass(changed && dirtyAt(2, r.period_start_date))}>
                    <input
                      type="date"
                      value={r.period_start_date}
                      onChange={(e) => update(r.key, { period_start_date: e.target.value })}
                      className={`${cellInput} font-mono tabular-nums`}
                    />
                  </td>
                  <td className={cellClass(changed && dirtyAt(3, r.music_type))}>
                    <select value={r.music_type} onChange={(e) => update(r.key, { music_type: e.target.value })} className={cellInput}>
                      <option value="">—</option>
                      {MUSIC_TYPES.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={`${cellClass(changed && (dirtyAt(5, r.target?.kind) || dirtyAt(6, r.target?.id)))} relative`}>
                    {editingTarget?.key === r.key ? (
                      <div className="space-y-1.5 p-1.5">
                        <div className="flex gap-1">
                          {TARGET_KINDS.map((k) => (
                            <button
                              key={k.value}
                              type="button"
                              onClick={() => setEditingTarget({ key: r.key, kind: k.value })}
                              className={`rounded px-2 py-0.5 text-[11px] ${editingTarget.kind === k.value ? 'bg-amber-400 text-black' : 'text-white/50 hover:bg-white/5'}`}
                            >
                              {k.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => setEditingTarget(null)}
                            className="ml-auto px-2 text-[11px] text-white/40 hover:text-white"
                          >
                            閉じる
                          </button>
                        </div>
                        <SearchableSelect
                          key={editingTarget.kind}
                          searchAction={SEARCH[editingTarget.kind]}
                          name={`target-${r.key}`}
                          inlineResults
                          placeholder={editingTarget.kind === 'track' ? '曲名(「曲名 アーティスト名」も可)' : '検索'}
                          onSelect={(item) => {
                            if (!item) return
                            update(r.key, { target: { kind: editingTarget.kind, id: item.id, label: item.label }, unresolved: undefined })
                            setEditingTarget(null)
                          }}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingTarget({ key: r.key, kind: r.target?.kind ?? 'track' })}
                        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-white/5"
                      >
                        {r.target ? (
                          <>
                            <span className="shrink-0 rounded bg-white/10 px-1.5 text-[10px] text-white/60">
                              {TARGET_KINDS.find((k) => k.value === r.target!.kind)?.label}
                            </span>
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
                  <td className={cellClass(changed && dirtyAt(4, r.note))}>
                    <input value={r.note} onChange={(e) => update(r.key, { note: e.target.value })} className={cellInput} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-start gap-3 border-t border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={addEmptyRow}
          className="rounded-md border border-white/15 px-3 py-1.5 text-xs hover:bg-white/5"
        >
          + 行を追加
        </button>
        <div className="min-w-0 flex-1">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={3}
            placeholder={'Excelから貼り付け(列: 局 / 番組 / 周期 / 開始日 / 区分 / 曲 / アーティスト / メモ)\nLuckyFM茨城放送\tパワープレイ\t月間\t2026/10/01\t邦楽\t夢\tITAZURA STORE\t'}
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
              曲はタイトルとアーティスト名で照合します。見つからない行は黄色で表示されるので、クリックして選び直してください。
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
