'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchAppleMusicArtistImage } from '@/utils/appleMusicImage'

export type ActionResult = { success: boolean; message?: string }

/**
 * 検索候補からApple Music IDを確定する。カタログ取込(アルバム/トラック同期)は
 * 行わない — このキューは既にカタログにいるアーティストの身元確認・画像補完
 * だけが目的で、フェスパイロットの新規取込とは役割が異なる。
 */
export async function confirmArtistAppleMusicId(artistId: string, appleMusicArtistId: number): Promise<ActionResult> {
  const supabase = createAdminClient()
  const imageUrl = await fetchAppleMusicArtistImage(String(appleMusicArtistId))
  const { error } = await supabase
    .from('artist')
    .update({ apple_music_artist_id: String(appleMusicArtistId), image_url: imageUrl })
    .eq('id', artistId)
  if (error) return { success: false, message: error.message }
  revalidatePath('/admin/data/artists/review')
  return { success: true }
}

/** 「該当なし」判断を記録し、以後この一覧に出さないようにする */
export async function skipImageMatch(artistId: string): Promise<ActionResult> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('artist')
    .update({ image_match_skipped_at: new Date().toISOString() })
    .eq('id', artistId)
  if (error) return { success: false, message: error.message }
  revalidatePath('/admin/data/artists/review')
  return { success: true }
}

/**
 * かな・英語表記を保存する。保存操作自体を「確認済み」の印とみなすため、
 * 両方空欄のまま保存しても(=読み方が分からないと確認した、という意味で)
 * name_reading_skipped_atを立てて一覧から外す。
 */
export async function saveArtistNameReading(artistId: string, nameKana: string, nameEn: string): Promise<ActionResult> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('artist')
    .update({
      name_kana: nameKana.trim() || null,
      name_en: nameEn.trim() || null,
      name_reading_skipped_at: new Date().toISOString(),
    })
    .eq('id', artistId)
  if (error) return { success: false, message: error.message }
  revalidatePath('/admin/data/artists/review')
  return { success: true }
}
