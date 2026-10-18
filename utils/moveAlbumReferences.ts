// utils/moveAlbumReferences.ts
/**
 * アルバムページに出る「掲載・選出」(ディスクガイド・キュレーション/ランキング・ラジオのオンエア)の
 * 参照を、あるアルバムから別のアルバムへ付け替える。アルバムページはそのページ自身のIDでしか
 * これらを探さないため、版違いグループの代表版を入れ替えたときに、旧代表版に付いたままだと
 * 新しい代表版のページに掲載が出なくなる。
 *
 * 付け替え先に同じ組み合わせ(ディスクガイドなど)が既にあって一意制約(23505)に当たる行は、
 * 重複なので旧側の行を削除する。
 */
import type { createAdminClient } from '@/utils/Supabase/admin'

type SupabaseAdminClient = ReturnType<typeof createAdminClient>

const TABLES = ['disc_guide_selection', 'ranking_entry', 'radio_rotation'] as const

export async function moveAlbumReferences(
  supabase: SupabaseAdminClient,
  fromAlbumId: string,
  toAlbumId: string
): Promise<{ moved: number; duplicatesRemoved: number }> {
  let moved = 0
  let duplicatesRemoved = 0
  for (const table of TABLES) {
    const { data: rows, error } = await supabase.from(table).select('id').eq('album_id', fromAlbumId)
    if (error) throw new Error(`${table}の取得に失敗: ${error.message}`)
    for (const row of rows ?? []) {
      const { error: updateError } = await supabase.from(table).update({ album_id: toAlbumId }).eq('id', row.id)
      if (!updateError) {
        moved++
      } else if (updateError.code === '23505') {
        const { error: deleteError } = await supabase.from(table).delete().eq('id', row.id)
        if (deleteError) throw new Error(`${table}の重複行の削除に失敗: ${deleteError.message}`)
        duplicatesRemoved++
      } else {
        throw new Error(`${table}の付け替えに失敗: ${updateError.message}`)
      }
    }
  }
  return { moved, duplicatesRemoved }
}
