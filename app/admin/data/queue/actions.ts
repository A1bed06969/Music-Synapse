'use server'

import { createAdminClient } from '@/utils/Supabase/admin'
import { safeRevalidatePath } from '@/utils/safeRevalidate'
import { registerPickIdToRotation } from '../media/radio-airplay-pick/actions'
import { confirmFeaturedArtist, rejectFeaturedArtist } from '../artists/featured-review/actions'

export type QueueActionResult = { success: boolean; message: string }

/** パワープレイ候補を採用して本登録する(radio-airplay-pickの「登録」と同じ処理) */
export async function approvePick(pickId: string): Promise<QueueActionResult> {
  const result = await registerPickIdToRotation(pickId)
  safeRevalidatePath('/admin/data/queue')
  return result
}

/** パワープレイ候補を外して未マッチに戻す(radio-airplay-pickの「候補を解除」と同じ処理) */
export async function rejectPick(pickId: string): Promise<QueueActionResult> {
  const { error } = await createAdminClient()
    .from('radio_airplay_pick')
    .update({
      candidate_track_id: null,
      candidate_track_name: null,
      candidate_artist_name: null,
      candidate_collection_id: null,
      candidate_collection_name: null,
      candidate_artwork_url: null,
    })
    .eq('id', pickId)
  safeRevalidatePath('/admin/data/queue')
  safeRevalidatePath('/admin/data/media/radio-airplay-pick')
  return error ? { success: false, message: error.message } : { success: true, message: '候補を外しました。' }
}

export async function approveFeatured(reviewId: string): Promise<QueueActionResult> {
  const result = await confirmFeaturedArtist(reviewId)
  safeRevalidatePath('/admin/data/queue')
  return result.success ? { success: true, message: '採用しました。' } : result
}

export async function rejectFeatured(reviewId: string): Promise<QueueActionResult> {
  const result = await rejectFeaturedArtist(reviewId)
  safeRevalidatePath('/admin/data/queue')
  return result.success ? { success: true, message: '却下しました。' } : result
}
