'use server'

import { createAdminClient } from '@/utils/Supabase/admin'
import { safeRevalidatePath } from '@/utils/safeRevalidate'

type ActionResult = { success: boolean; message: string }

/** Gemini生成bioを取り消し、元の状態(previous_bio)に戻す。以後このアーティストは
 * バッチ処理の対象から除外される(scripts/generate-artist-bios.tsの
 * biography_status !== 'REVERTED'条件)。 */
export async function revertBioGeneration(logId: string): Promise<ActionResult> {
  const supabase = createAdminClient()

  const { data: log } = await supabase
    .from('bio_generation_log')
    .select('id, artist_id, previous_bio, status')
    .eq('id', logId)
    .maybeSingle()
  if (!log) return { success: false, message: 'ログが見つかりません。' }
  if (log.status === 'reverted') return { success: false, message: '既に取消済みです。' }

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
