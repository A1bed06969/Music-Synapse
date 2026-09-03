'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchTrackById, parseAppleMusicAlbumUrl } from '@/utils/itunes'
import type { PickerItem } from '../radio-airplay-pick/actions'

type AddPickResult = { success: boolean; message: string; item?: PickerItem }

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
 * fact_checked_correctはtrueで保存する。campaignNameは「番組」選択欄で選んだ
 * 番組名(未選択ならnull)。 */
export async function addManualPick(
  stationName: string,
  region: string,
  monthKey: string,
  artistName: string,
  trackTitle: string,
  campaignName: string | null = null
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
    campaign_name: campaignName,
  })
  revalidatePath('/admin/data/media/radio-fact-check')
}

/** 手動追加の本命経路。Apple Musicの検索結果(radio-airplay-pick/actions.tsの
 * searchAppleMusicTracksForPickを流用)から選んだ候補で、局サイトを見て確認した
 * 選曲を新規登録する。addManualPickとは異なり、candidate_*列も最初から
 * 埋まった状態で保存されるため、この後のマッチング画面での再検索が不要になる。 */
export async function addManualPickFromSearch(
  stationName: string,
  region: string,
  monthKey: string,
  trackId: string,
  campaignName: string | null = null
): Promise<AddPickResult> {
  let match
  try {
    match = await fetchTrackById(Number(trackId))
  } catch {
    match = null
  }
  if (!match) {
    return { success: false, message: '候補の再取得に失敗しました。もう一度検索してください。' }
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('radio_airplay_pick').insert({
    region,
    station_name: stationName,
    picked_date: `${monthKey}-01`,
    artist_name: match.artistName,
    track_title: match.trackName,
    fact_checked_correct: true,
    campaign_name: campaignName,
    candidate_track_id: match.trackId,
    candidate_track_name: match.trackName,
    candidate_artist_name: match.artistName,
    candidate_collection_id: match.collectionId,
    candidate_collection_name: match.collectionName,
    candidate_artwork_url: match.artworkUrl100 ?? null,
  })

  if (error) {
    return { success: false, message: `保存に失敗しました: ${error.message}` }
  }

  revalidatePath('/admin/data/media/radio-fact-check')
  return {
    success: true,
    message: '保存しました。',
    item: { id: String(match.trackId), label: `${match.trackName} — ${match.artistName}`, imageUrl: match.artworkUrl100 },
  }
}

/** 検索で見つからない場合(表記ゆれ・無名アーティストが同名の有名曲に検索順位で
 * 負ける等)のフォールバック。Apple Musicアプリで曲を選択した状態でコピーした
 * URL(末尾に?i=数字が付いたもの)を直接貼って登録する。 */
export async function addManualPickFromUrl(
  stationName: string,
  region: string,
  monthKey: string,
  url: string,
  campaignName: string | null = null
): Promise<AddPickResult> {
  const parsed = parseAppleMusicAlbumUrl(url.trim())
  if (!parsed?.trackId) {
    return {
      success: false,
      message: 'Apple Musicで曲を選択した状態でコピーしたURL(末尾に?i=数字が付いたもの)を貼ってください。',
    }
  }
  return addManualPickFromSearch(stationName, region, monthKey, String(parsed.trackId), campaignName)
}
