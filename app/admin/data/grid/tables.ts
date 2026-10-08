// 共通の表編集(DataGrid)で扱うテーブルの定義。どのテーブル・列を書き換えられるかは
// ここ(サーバー側)だけで決め、クライアントからはキー(tableKey)しか受け取らない。
import { createAdminClient } from '@/utils/Supabase/admin'

export type TargetKind = 'track' | 'album' | 'artist'
export type GridTarget = { kind: TargetKind; id: string; label: string }
export type CellValue = string | number | boolean | null

export type ColumnDef =
  | { key: string; label: string; type: 'text' | 'number' | 'date' | 'checkbox'; width?: string }
  | { key: string; label: string; type: 'select'; options: { value: string; label: string }[]; width?: string }
  | { key: 'target'; label: string; type: 'target'; kinds: TargetKind[] }

export type GridRow = {
  key: string
  id?: string
  values: Record<string, CellValue>
  target: GridTarget | null
  /** 貼り付けで照合できなかった元の文字列 */
  unresolved?: string
}

export type TableConfig = {
  table: string
  /** 表を絞り込む親のID列(このランキング、このディスクガイド等) */
  scopeColumn: string
  columns: ColumnDef[]
  required: string[]
  orderBy: { column: string; ascending: boolean }[]
}

export const TARGET_COLUMNS: Record<TargetKind, string> = { track: 'track_id', album: 'album_id', artist: 'artist_id' }

export const GRID_TABLES = {
  ranking: {
    table: 'ranking_entry',
    scopeColumn: 'ranking_id',
    columns: [
      { key: 'rank', label: '順位', type: 'number', width: 'w-20' },
      { key: 'period_date', label: '対象日', type: 'date', width: 'w-36' },
      { key: 'target', label: '曲・アルバム・アーティスト', type: 'target', kinds: ['album', 'track', 'artist'] },
      { key: 'metric_label', label: '指標名', type: 'text', width: 'w-32' },
      { key: 'metric_value', label: '指標値', type: 'number', width: 'w-24' },
    ],
    required: ['period_date', 'target'],
    orderBy: [
      { column: 'period_date', ascending: false },
      { column: 'rank', ascending: true },
    ],
  },
  discguide: {
    table: 'disc_guide_selection',
    scopeColumn: 'disc_guide_id',
    columns: [
      { key: 'target', label: 'アルバム', type: 'target', kinds: ['album'] },
      { key: 'note', label: 'メモ', type: 'text', width: 'w-64' },
    ],
    required: ['target'],
    orderBy: [{ column: 'created_at', ascending: true }],
  },
  festival: {
    table: 'event_appearance',
    scopeColumn: 'event_edition_id',
    columns: [
      { key: 'target', label: 'アーティスト', type: 'target', kinds: ['artist'] },
      { key: 'display_name', label: '表示名(任意)', type: 'text', width: 'w-48' },
      { key: 'stage', label: 'ステージ', type: 'text', width: 'w-40' },
      { key: 'venue', label: '会場', type: 'text', width: 'w-40' },
      { key: 'is_headliner', label: 'ヘッドライナー', type: 'checkbox', width: 'w-28' },
    ],
    required: ['target'],
    orderBy: [{ column: 'id', ascending: true }],
  },
  award: {
    table: 'award_entry',
    scopeColumn: 'award_id',
    columns: [
      { key: 'year', label: '年', type: 'number', width: 'w-20' },
      { key: 'category', label: '部門', type: 'text', width: 'w-48' },
      {
        key: 'result',
        label: '結果',
        type: 'select',
        options: [
          { value: 'winner', label: '受賞' },
          { value: 'nominee', label: 'ノミネート' },
        ],
        width: 'w-32',
      },
      { key: 'target', label: '曲・アルバム・アーティスト', type: 'target', kinds: ['album', 'track', 'artist'] },
    ],
    required: ['year', 'target'],
    orderBy: [
      { column: 'year', ascending: false },
      { column: 'category', ascending: true },
    ],
  },
} satisfies Record<string, TableConfig>

export type GridTableKey = keyof typeof GRID_TABLES

export function getTableConfig(key: string): TableConfig {
  const config = (GRID_TABLES as Record<string, TableConfig>)[key]
  if (!config) throw new Error(`未対応の表です: ${key}`)
  return config
}

type Joined = { id: string; title?: string; name?: string; artist?: { name: string } | { name: string }[] | null }
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

export function targetLabel(kind: TargetKind, row: Joined): string {
  if (kind === 'artist') return row.name ?? ''
  const artist = one(row.artist)
  return `${row.title ?? ''}${artist?.name ? ` — ${artist.name}` : ''}`
}

/** 表の初期表示用に、親IDで絞った行を読み込む */
export async function loadGridRows(key: GridTableKey, scopeId: string): Promise<GridRow[]> {
  const config = getTableConfig(key)
  const target = config.columns.find((c) => c.type === 'target') as Extract<ColumnDef, { type: 'target' }> | undefined
  const plain = config.columns.filter((c) => c.type !== 'target').map((c) => c.key)
  const joins = (target?.kinds ?? []).map((kind) =>
    kind === 'artist'
      ? 'artist:artist_id(id, name)'
      : `${kind}:${TARGET_COLUMNS[kind]}(id, title, artist:artist_id(name))`
  )
  const select = ['id', ...plain, ...joins].join(', ')

  const supabase = createAdminClient()
  const rows: GridRow[] = []
  for (let from = 0; ; from += 1000) {
    let query = supabase.from(config.table).select(select).eq(config.scopeColumn, scopeId)
    for (const o of config.orderBy) query = query.order(o.column, { ascending: o.ascending, nullsFirst: false })
    const { data, error } = await query.range(from, from + 999)
    if (error) throw new Error(`読み込みに失敗しました: ${error.message}`)
    const page = (data ?? []) as unknown as Record<string, unknown>[]
    for (const r of page) {
      let t: GridTarget | null = null
      for (const kind of target?.kinds ?? []) {
        const joined = one(r[kind] as Joined | Joined[] | null)
        if (joined) {
          t = { kind, id: joined.id, label: targetLabel(kind, joined) }
          break
        }
      }
      rows.push({
        key: String(r.id),
        id: String(r.id),
        values: Object.fromEntries(plain.map((k) => [k, (r[k] as CellValue) ?? null])),
        target: t,
      })
    }
    if (page.length < 1000) break
  }
  return rows
}
