'use server'

import { createAdminClient } from '@/utils/Supabase/admin'
import { safeRevalidatePath } from '@/utils/safeRevalidate'
import {
  getTableConfig,
  resolveColumns,
  targetLabel,
  TARGET_COLUMNS,
  type CellValue,
  type ColumnDef,
  type GridRow,
  type GridTarget,
} from './tables'

export type GridSaveResult = { success: boolean; message: string; errors: { key: string; message: string }[] }

function toDbValue(col: ColumnDef, value: CellValue): CellValue {
  if (col.type === 'number') return value === '' || value === null ? null : Number(value)
  if (col.type === 'checkbox') return Boolean(value)
  if (typeof value === 'string') return value.trim() || null
  return value
}

/** 共通の表で編集した変更(更新・追加・削除)をまとめて保存する。問題のある行だけをエラーで返す */
export async function saveGrid(
  tableKey: string,
  scopeId: string | null,
  payload: { updates: GridRow[]; inserts: GridRow[]; deletes: string[] },
  revalidate: string[]
): Promise<GridSaveResult> {
  const config = getTableConfig(tableKey)
  const targetCol = config.columns.find((c) => c.type === 'target') as Extract<ColumnDef, { type: 'target' }> | undefined
  const supabase = createAdminClient()
  const errors: { key: string; message: string }[] = []
  let done = 0

  // 画面側で隠していても、許可していない操作はサーバー側で必ず拒否する
  if (config.allowInsert === false && payload.inserts.length > 0) {
    return { success: false, message: 'この表では行を追加できません。', errors: [] }
  }
  if (config.allowDelete === false && payload.deletes.length > 0) {
    return { success: false, message: 'この表では行を削除できません。', errors: [] }
  }
  if (config.scopeColumn && !scopeId) {
    return { success: false, message: '対象が指定されていません。', errors: [] }
  }
  const scoped = <Q extends { eq: (column: string, value: string) => Q }>(q: Q): Q =>
    config.scopeColumn && scopeId ? q.eq(config.scopeColumn, scopeId) : q

  const toDbRow = (row: GridRow) => {
    const db: Record<string, CellValue> = {}
    for (const col of config.columns) {
      if (col.type === 'target' || col.type === 'link') continue
      db[col.key] = toDbValue(col, row.values[col.key] ?? null)
    }
    for (const kind of targetCol?.kinds ?? []) {
      db[TARGET_COLUMNS[kind]] = row.target?.kind === kind ? row.target.id : null
    }
    return db
  }
  const validate = (row: GridRow): string | null => {
    for (const key of config.required) {
      if (key === 'target') {
        if (!row.target) return '曲・アルバム・アーティストを選んでください'
        continue
      }
      const v = row.values[key]
      if (v === null || v === undefined || v === '') {
        return `「${config.columns.find((c) => c.key === key)?.label ?? key}」が未入力です`
      }
    }
    return null
  }

  for (const row of [...payload.updates, ...payload.inserts]) {
    const problem = validate(row)
    if (problem) errors.push({ key: row.key, message: problem })
  }
  const invalid = new Set(errors.map((e) => e.key))

  for (const row of payload.updates) {
    if (invalid.has(row.key) || !row.id) continue
    const { error } = await scoped(supabase.from(config.table).update(toDbRow(row)).eq('id', row.id))
    if (error) errors.push({ key: row.key, message: error.message })
    else done++
  }

  const inserts = payload.inserts.filter((r) => !invalid.has(r.key))
  if (inserts.length > 0) {
    const { error } = await supabase
      .from(config.table)
      .insert(inserts.map((r) => (config.scopeColumn ? { ...toDbRow(r), [config.scopeColumn]: scopeId } : toDbRow(r))))
    if (error) for (const r of inserts) errors.push({ key: r.key, message: error.message })
    else done += inserts.length
  }

  if (payload.deletes.length > 0) {
    const { error } = await scoped(supabase.from(config.table).delete().in('id', payload.deletes))
    if (error) errors.push({ key: 'delete', message: `削除に失敗しました: ${error.message}` })
    else done += payload.deletes.length
  }

  for (const path of revalidate) safeRevalidatePath(path)
  return {
    success: errors.length === 0,
    message: errors.length === 0 ? `${done}件を保存しました。` : `${done}件を保存、${errors.length}件は保存できませんでした。`,
    errors,
  }
}

function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[\s!！・'’"]/g, '')
}

/** 貼り付け列の順番。表の列順と同じだが、対象(曲・アルバム・アーティスト)の列だけは
 * 「タイトル」「アーティスト」の2列に分かれる(アーティストだけを選ぶ行はタイトルを空欄にする) */
export async function pasteColumnLabels(tableKey: string): Promise<string[]> {
  const config = getTableConfig(tableKey)
  return config.columns.flatMap((c) =>
    c.type === 'link' ? [] : c.type === 'target' ? ['タイトル', 'アーティスト'] : [c.label]
  )
}

async function resolveTarget(kinds: GridTarget['kind'][], title: string, artistName: string): Promise<GridTarget | null> {
  const supabase = createAdminClient()
  const artistMatches = (a: { name: string } | { name: string }[] | null) => {
    const artist = Array.isArray(a) ? a[0] : a
    return !artistName || norm(artist?.name ?? '') === norm(artistName)
  }
  if (title) {
    for (const kind of kinds.filter((k) => k !== 'artist')) {
      const { data } = await supabase
        .from(kind === 'track' ? 'track' : 'album')
        .select('id, title, artist:artist_id(name)')
        .ilike('title', title)
        .limit(50)
      const hit = (data ?? []).find((r) => artistMatches(r.artist))
      if (hit) return { kind, id: hit.id, label: targetLabel(kind, hit) }
    }
    return null
  }
  if (artistName && kinds.includes('artist')) {
    const { data } = await supabase.from('artist').select('id, name').ilike('name', artistName).limit(2)
    if (data?.length === 1) return { kind: 'artist', id: data[0].id, label: data[0].name }
  }
  return null
}

/** Excel等から貼り付けた行を新規行に変換する。選択肢の列は表示名でも値でも受け付ける */
export async function resolveGridPaste(tableKey: string, lines: string[][]): Promise<GridRow[]> {
  const config = getTableConfig(tableKey)
  if (config.allowInsert === false) return []
  const columns = await resolveColumns(config)
  const rows: GridRow[] = []
  for (const [i, cols] of lines.entries()) {
    const cells = [...cols.map((c) => c.trim())]
    const values: Record<string, CellValue> = {}
    let target: GridTarget | null = null
    let unresolved: string | undefined
    for (const col of columns) {
      if (col.type === 'link') continue
      if (col.type === 'target') {
        const title = cells.shift() ?? ''
        const artistName = cells.shift() ?? ''
        target = await resolveTarget(col.kinds, title, artistName)
        if (!target && (title || artistName)) unresolved = [title, artistName].filter(Boolean).join(' / ')
        continue
      }
      const raw = cells.shift() ?? ''
      if (col.type === 'select') {
        values[col.key] = (col.options ?? []).find((o) => o.label === raw || o.value === raw)?.value ?? ''
      } else if (col.type === 'checkbox') {
        values[col.key] = /^(1|true|yes|y|○|◯|はい|true)$/i.test(raw)
      } else if (col.type === 'date') {
        values[col.key] = raw
          .replace(/\//g, '-')
          .replace(/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (_, y, m, d) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`)
      } else {
        values[col.key] = raw
      }
    }
    rows.push({ key: `paste-${Date.now()}-${i}`, values, target, unresolved })
  }
  return rows
}
