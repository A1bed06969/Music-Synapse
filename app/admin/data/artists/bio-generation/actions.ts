'use server'

import { createAdminClient } from '@/utils/Supabase/admin'
import { safeRevalidatePath } from '@/utils/safeRevalidate'

type ActionResult = { success: boolean; message: string }

/** Gemini生成bioを取り消し、元の状態(previous_bio)に戻す。以後このアーティストは
 * バッチ処理の対象から除外される(scripts/generate-artist-bios.tsの
 * biography_status !== 'REVERTED'条件)。
 *
 * 生成後に人間が手動でbioを編集している可能性があるため、現在のbioが
 * generated_bio(生成直後の値)と完全一致する場合のみ取り消しを実行する。
 * 一致しなければ、手動編集を無条件に上書きしてしまうのを避けるため中断する。 */
export async function revertBioGeneration(logId: string): Promise<ActionResult> {
  const supabase = createAdminClient()

  const { data: log } = await supabase
    .from('bio_generation_log')
    .select('id, artist_id, previous_bio, generated_bio, status')
    .eq('id', logId)
    .maybeSingle()
  if (!log) return { success: false, message: 'ログが見つかりません。' }
  if (log.status === 'reverted') return { success: false, message: '既に取消済みです。' }

  const { data: currentArtist } = await supabase.from('artist').select('bio').eq('id', log.artist_id).maybeSingle()
  if (!currentArtist) return { success: false, message: 'アーティストが見つかりません。' }
  if (currentArtist.bio !== log.generated_bio) {
    return {
      success: false,
      message: 'アーティストのbioが生成後に変更されているため、取り消せません。手動で確認してください。',
    }
  }

  const { error: updateError } = await supabase
    .from('artist')
    .update({ bio: log.previous_bio, biography_status: 'REVERTED' })
    .eq('id', log.artist_id)
  if (updateError) return { success: false, message: `取消に失敗しました: ${updateError.message}` }

  await supabase
    .from('bio_generation_log')
    .update({ status: 'reverted', reverted_at: new Date().toISOString() })
    .eq('id', logId)

  safeRevalidatePath(`/artists/${log.artist_id}`)
  safeRevalidatePath('/admin/data/artists/bio-generation')
  return { success: true, message: '取り消しました。' }
}
