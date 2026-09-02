'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'

/** 自動抽出(Gemini)の結果が局サイトの内容と合っていたことを記録する。 */
export async function markFactCheckCorrect(pickId: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('radio_airplay_pick').update({ fact_checked_correct: true }).eq('id', pickId)
  revalidatePath('/admin/data/media/radio-fact-check')
}

/** 自動抽出が間違っていた行を、その場で正しいアーティスト名・曲名に修正して保存する。
 * 修正後の値はこの列を参照しない既存のマッチング/登録フローでもそのまま使われる。 */
export async function saveFactCheckCorrection(pickId: string, artistName: string, trackTitle: string): Promise<void> {
  const trimmedArtist = artistName.trim()
  const trimmedTitle = trackTitle.trim()
  if (!trimmedArtist || !trimmedTitle) return

  const supabase = createAdminClient()
  await supabase
    .from('radio_airplay_pick')
    .update({ artist_name: trimmedArtist, track_title: trimmedTitle, fact_checked_correct: false })
    .eq('id', pickId)
  revalidatePath('/admin/data/media/radio-fact-check')
}

/** 局サイトが今月分ではなく別の月の選曲を返してきた等、その月の候補として
 * そもそも成立しない行を一覧から取り除く(アーティスト名・曲名の修正では
 * 直せないケース向け)。まだ本登録前の候補データのみが対象の画面のため、
 * 単純に候補行を削除するだけでよい。 */
export async function deleteFactCheckPick(pickId: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('radio_airplay_pick').delete().eq('id', pickId)
  revalidatePath('/admin/data/media/radio-fact-check')
}

/** 自動抽出が0件だった局(または元々手動専用の局)向けに、局サイトを直接見て
 * 確認した選曲をその場で新規登録する。人力で確認した上での入力のため、
 * fact_checked_correctはtrueで保存する。 */
export async function addManualPick(
  stationName: string,
  region: string,
  monthKey: string,
  artistName: string,
  trackTitle: string
): Promise<void> {
  const trimmedArtist = artistName.trim()
  const trimmedTitle = trackTitle.trim()
  if (!trimmedArtist || !trimmedTitle) return

  const supabase = createAdminClient()
  await supabase.from('radio_airplay_pick').insert({
    region,
    station_name: stationName,
    picked_date: `${monthKey}-01`,
    artist_name: trimmedArtist,
    track_title: trimmedTitle,
    fact_checked_correct: true,
  })
  revalidatePath('/admin/data/media/radio-fact-check')
}
