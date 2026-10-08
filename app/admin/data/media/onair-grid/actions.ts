'use server'

import { createAdminClient } from '@/utils/Supabase/admin'
import { safeRevalidatePath } from '@/utils/safeRevalidate'

export type GridTarget = { kind: 'track' | 'album' | 'artist'; id: string; label: string }

export type GridRow = {
  key: string
  id?: string
  media_program_id: string
  period_type: string
  period_start_date: string
  music_type: string
  note: string
  target: GridTarget | null
  /** 貼り付けで照合できなかった元の文字列(曲/アーティスト)。targetを選ぶまで保存できない */
  unresolved?: string
  /** 貼り付けで照合できなかった局・番組名 */
  unresolvedProgram?: string
}

export type SaveResult = { success: boolean; message: string; errors: { key: string; message: string }[] }

function validate(row: GridRow): string | null {
  if (!row.media_program_id) return '番組が未選択です'
  if (!row.period_type) return '周期が未選択です'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.period_start_date)) return '開始日が不正です'
  if (!row.music_type) return '邦楽/洋楽が未選択です'
  if (!row.target) return '曲・アルバム・アーティストのいずれかを選んでください'
  return null
}

function toDbRow(row: GridRow) {
  return {
    media_program_id: row.media_program_id,
    period_type: row.period_type,
    period_start_date: row.period_start_date,
    music_type: row.music_type,
    note: row.note.trim() || null,
    track_id: row.target?.kind === 'track' ? row.target.id : null,
    album_id: row.target?.kind === 'album' ? row.target.id : null,
    artist_id: row.target?.kind === 'artist' ? row.target.id : null,
  }
}

/** 表で編集した変更(更新・追加・削除)をまとめて保存する。行ごとに検証し、
 * 問題のある行だけをエラーとして返す(他の行の保存は止めない)。 */
export async function saveOnAirGrid(payload: {
  updates: GridRow[]
  inserts: GridRow[]
  deletes: string[]
}): Promise<SaveResult> {
  const supabase = createAdminClient()
  const errors: { key: string; message: string }[] = []
  let done = 0

  for (const row of [...payload.updates, ...payload.inserts]) {
    const problem = validate(row)
    if (problem) errors.push({ key: row.key, message: problem })
  }
  const invalid = new Set(errors.map((e) => e.key))

  for (const row of payload.updates) {
    if (invalid.has(row.key) || !row.id) continue
    const { error } = await supabase.from('radio_rotation').update(toDbRow(row)).eq('id', row.id)
    if (error) errors.push({ key: row.key, message: error.message })
    else done++
  }

  const inserts = payload.inserts.filter((r) => !invalid.has(r.key))
  if (inserts.length > 0) {
    const { error } = await supabase.from('radio_rotation').insert(inserts.map(toDbRow))
    if (error) for (const r of inserts) errors.push({ key: r.key, message: error.message })
    else done += inserts.length
  }

  if (payload.deletes.length > 0) {
    // 表から消した行は、元になった選出データ(radio_airplay_pick)ごと消す。残すと
    // 「マッチ済み・未登録」に戻り、作業キューや一括検証で再登録されて復活してしまうため。
    // 選出データは判定ログ(radio_pick_match_log)からも参照されているので、ログ→選出データ→行の順に消す
    const { data: picks } = await supabase.from('radio_airplay_pick').select('id').in('registered_rotation_id', payload.deletes)
    const pickIds = (picks ?? []).map((p) => p.id as string)
    let deleteError: { message: string } | null = null
    if (pickIds.length > 0) {
      const { error: logError } = await supabase.from('radio_pick_match_log').delete().in('pick_id', pickIds)
      const { error: pickError } = logError
        ? { error: logError }
        : await supabase.from('radio_airplay_pick').delete().in('id', pickIds)
      deleteError = pickError
    }
    const { error } = deleteError
      ? { error: deleteError }
      : await supabase.from('radio_rotation').delete().in('id', payload.deletes)
    if (error) errors.push({ key: 'delete', message: `削除に失敗しました: ${error.message}` })
    else done += payload.deletes.length
  }

  safeRevalidatePath('/admin/data/media')
  safeRevalidatePath('/admin/data/media/onair-grid')
  safeRevalidatePath('/media/on-air')
  return {
    success: errors.length === 0,
    message: errors.length === 0 ? `${done}件を保存しました。` : `${done}件を保存、${errors.length}件は保存できませんでした。`,
    errors,
  }
}

function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[\s!！・'’"]/g, '')
}

const MUSIC_TYPES: Record<string, string> = { 邦楽: 'DOMESTIC', 洋楽: 'OVERSEAS', domestic: 'DOMESTIC', overseas: 'OVERSEAS' }
const PERIOD_TYPES: Record<string, string> = { 週間: 'weekly', 月間: 'monthly', weekly: 'weekly', monthly: 'monthly' }

/** Excel等から貼り付けた行(表と同じ列順: 局, 番組, 周期, 開始日, 区分, 曲, アーティスト, メモ)を
 * 新規行に変換する。局・番組は名前で、曲はタイトル+アーティスト名の完全一致で照合し、
 * 一意に決まらないものはunresolvedとして返す(表で検索して選び直す)。 */
export async function resolvePastedRows(lines: string[][]): Promise<GridRow[]> {
  const supabase = createAdminClient()
  const { data: programs } = await supabase
    .from('media_program')
    .select('id, program_name, period_type, media:media_id(name)')
  const programIndex = new Map<string, { id: string; period_type: string }>()
  for (const p of programs ?? []) {
    const media = Array.isArray(p.media) ? p.media[0] : p.media
    programIndex.set(`${norm(media?.name ?? '')}|${norm(p.program_name)}`, { id: p.id, period_type: p.period_type })
  }

  const rows: GridRow[] = []
  for (const [i, cols] of lines.entries()) {
    const [station = '', program = '', period = '', date = '', musicType = '', title = '', artistName = '', note = ''] =
      cols.map((c) => c.trim())
    const prog = programIndex.get(`${norm(station)}|${norm(program)}`)
    const isoDate = date.replace(/\//g, '-').replace(/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (_, y, m, d) =>
      `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    )

    let target: GridTarget | null = null
    if (title) {
      const { data: tracks } = await supabase
        .from('track')
        .select('id, title, artist:artist_id(name), album:album_id(title)')
        .ilike('title', title)
        .limit(50)
      const hits = (tracks ?? []).filter((t) => {
        const a = Array.isArray(t.artist) ? t.artist[0] : t.artist
        return !artistName || norm(a?.name ?? '') === norm(artistName)
      })
      if (hits.length >= 1) {
        const t = hits[0]
        const a = Array.isArray(t.artist) ? t.artist[0] : t.artist
        const al = Array.isArray(t.album) ? t.album[0] : t.album
        target = { kind: 'track', id: t.id, label: `${t.title} — ${a?.name ?? ''}${al?.title ? `(${al.title})` : ''}` }
      }
    } else if (artistName) {
      const { data: artists } = await supabase.from('artist').select('id, name').ilike('name', artistName).limit(2)
      if (artists?.length === 1) target = { kind: 'artist', id: artists[0].id, label: artists[0].name }
    }

    rows.push({
      key: `paste-${Date.now()}-${i}`,
      media_program_id: prog?.id ?? '',
      period_type: PERIOD_TYPES[period.toLowerCase()] ?? PERIOD_TYPES[period] ?? prog?.period_type ?? '',
      period_start_date: /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate : '',
      music_type: MUSIC_TYPES[musicType.toLowerCase()] ?? MUSIC_TYPES[musicType] ?? '',
      note,
      target,
      unresolved: target ? undefined : [title, artistName].filter(Boolean).join(' / ') || undefined,
      unresolvedProgram: prog ? undefined : [station, program].filter(Boolean).join(' / ') || undefined,
    })
  }
  return rows
}
