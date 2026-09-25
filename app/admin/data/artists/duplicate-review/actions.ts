'use server'

import { createAdminClient } from '@/utils/Supabase/admin'
import { safeRevalidatePath } from '@/utils/safeRevalidate'

type ActionResult = { success: true } | { success: false; message: string }

// 単一カラムFK(artist_id)で、統合先に既に行があっても問題ない(=1対多で自然)
// テーブル一覧。scripts/tmp-merge-duplicate-artists.mts(2026-09-23、同名重複の
// 一括統合で使用)と同じ対応表。
const SIMPLE_TABLES: { table: string; column: string }[] = [
  { table: 'album', column: 'artist_id' },
  { table: 'track', column: 'artist_id' },
  { table: 'featured_artist_review', column: 'artist_id' },
  { table: 'radio_rotation', column: 'artist_id' },
  { table: 'ranking_entry', column: 'artist_id' },
  { table: 'award_entry', column: 'artist_id' },
  { table: 'contest_entry', column: 'artist_id' },
  { table: 'event_appearance', column: 'artist_id' },
  { table: 'genre_highlight', column: 'artist_id' },
  { table: 'music_event', column: 'artist_id' },
  { table: 'setlist', column: 'artist_id' },
  { table: 'bio_generation_log', column: 'artist_id' },
  { table: 'youtube_mv_backfill_log', column: 'artist_id' },
  { table: 'artist_match_log', column: 'stub_artist_id' },
  { table: 'artist_credit', column: 'artist_id' },
  { table: 'festival_pilot_artist_link', column: 'artist_id' },
]

// (他カラム, artist_id)の組が実質ユニークキーになっている中間テーブル(idカラムを
// 持つもの)。統合先に既に同じ組が存在するなら、統合元側の行は削除してdedupeする
const JUNCTION_TABLES: { table: string; otherColumn: string }[] = [
  { table: 'track_artist', otherColumn: 'track_id' },
  { table: 'album_artist', otherColumn: 'album_id' },
  { table: 'artist_label', otherColumn: 'label_id' },
  { table: 'event_appearance_artist', otherColumn: 'event_appearance_id' },
  { table: 'person_artist_relation', otherColumn: 'person_id' },
]

/** 手動レビューで「同一人物」と判定された複数のartist行を1件(keeperId)に統合する。
 * 全25箇所のartist_id参照(FK一覧はscripts/tmp-merge-duplicate-artists.mts作成時に
 * information_schemaから洗い出したもの)を漏れなく付け替えてからloserを削除する。 */
export async function mergeArtists(keeperId: string, loserIds: string[]): Promise<ActionResult> {
  const supabase = createAdminClient()

  for (const loserId of loserIds) {
    if (loserId === keeperId) continue

    for (const { table, column } of SIMPLE_TABLES) {
      const { error } = await supabase.from(table).update({ [column]: keeperId }).eq(column, loserId)
      if (error && error.code === '23505') {
        await supabase.from(table).delete().eq(column, loserId)
      } else if (error) {
        return { success: false, message: `${table}.${column}の付け替えに失敗しました: ${error.message}` }
      }
    }

    for (const { table, otherColumn } of JUNCTION_TABLES) {
      const { data: loserRows } = await supabase.from(table).select('*').eq('artist_id', loserId)
      for (const row of (loserRows ?? []) as unknown as Record<string, unknown>[]) {
        const otherValue = row[otherColumn]
        const { data: existing } = await supabase
          .from(table)
          .select('id')
          .eq('artist_id', keeperId)
          .eq(otherColumn, otherValue as string)
          .maybeSingle()
        if (existing) {
          await supabase.from(table).delete().eq('id', row.id as string)
        } else {
          await supabase.from(table).update({ artist_id: keeperId }).eq('id', row.id as string)
        }
      }
    }

    const { data: loserGenres } = await supabase.from('artist_genre').select('genre_id').eq('artist_id', loserId)
    for (const g of loserGenres ?? []) {
      const { data: existing } = await supabase
        .from('artist_genre')
        .select('artist_id')
        .eq('artist_id', keeperId)
        .eq('genre_id', g.genre_id)
        .maybeSingle()
      if (existing) {
        await supabase.from('artist_genre').delete().eq('artist_id', loserId).eq('genre_id', g.genre_id)
      } else {
        await supabase.from('artist_genre').update({ artist_id: keeperId }).eq('artist_id', loserId).eq('genre_id', g.genre_id)
      }
    }

    const { data: loserLinks } = await supabase
      .from('artist_external_link')
      .select('id, link_type, url')
      .eq('artist_id', loserId)
    for (const link of loserLinks ?? []) {
      const { data: existing } = await supabase
        .from('artist_external_link')
        .select('id')
        .eq('artist_id', keeperId)
        .eq('link_type', link.link_type)
        .eq('url', link.url)
        .maybeSingle()
      if (existing) {
        await supabase.from('artist_external_link').delete().eq('id', link.id)
      } else {
        await supabase.from('artist_external_link').update({ artist_id: keeperId }).eq('id', link.id)
      }
    }

    for (const col of ['artist_id_a', 'artist_id_b'] as const) {
      const otherCol = col === 'artist_id_a' ? 'artist_id_b' : 'artist_id_a'
      const { data: relRows } = await supabase.from('artist_relation').select(`id, relation_type, ${otherCol}`).eq(col, loserId)
      for (const rel of (relRows ?? []) as Record<string, unknown>[]) {
        const otherId = rel[otherCol] as string
        if (otherId === keeperId) {
          await supabase.from('artist_relation').delete().eq('id', rel.id as string)
          continue
        }
        const { data: existing } = await supabase
          .from('artist_relation')
          .select('id')
          .eq(col, keeperId)
          .eq(otherCol, otherId)
          .eq('relation_type', rel.relation_type as string)
          .maybeSingle()
        if (existing) {
          await supabase.from('artist_relation').delete().eq('id', rel.id as string)
        } else {
          await supabase.from('artist_relation').update({ [col]: keeperId }).eq('id', rel.id as string)
        }
      }
    }

    const { error: deleteError } = await supabase.from('artist').delete().eq('id', loserId)
    if (deleteError) {
      return { success: false, message: `統合元アーティストの削除に失敗しました: ${deleteError.message}` }
    }
  }

  safeRevalidatePath('/admin/data/artists/duplicate-review')
  return { success: true }
}

/** 「同名だが別人」と判定したグループを記録し、以後のレビュー一覧から除外する。 */
export async function markGroupAsConfirmedSeparate(artistName: string, artistIds: string[]): Promise<ActionResult> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('artist_duplicate_review')
    .insert({ artist_name: artistName, artist_ids: artistIds })
  if (error) return { success: false, message: error.message }

  safeRevalidatePath('/admin/data/artists/duplicate-review')
  return { success: true }
}
