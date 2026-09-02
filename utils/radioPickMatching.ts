// utils/radioPickMatching.ts
//
// ラジオ局PP選曲(アーティスト名+曲名)に対するApple Music候補の検索ロジック。
// scripts/backfill-radio-pick-itunes-candidates.ts(手動HRPPシート向け)と
// app/api/cron/radio-power-play(自動収集向け)の両方から使う共通処理。
import { searchTracks } from './itunes.ts'

export type ItunesTrackMatch = {
  trackId: number
  trackName: string
  artistName: string
  collectionId: number
  collectionName: string
  artworkUrl100?: string
}

/** アーティスト名+曲名でApple Musicを検索し、上位1件を候補として返す。
 * 見つからなければnull。誤マッチのリスクがあるため、あくまで「候補」であり
 * 呼び出し側は必ず人力確認を経てからカタログへ反映する。 */
export async function findItunesCandidate(artistName: string, trackTitle: string): Promise<ItunesTrackMatch | null> {
  const results = await searchTracks(`${artistName} ${trackTitle}`, 1)
  return results[0] ?? null
}

// iTunes側の(非公式・undocumentedな)IPレート制限は、fetchItunes内の
// 400ms間隔だけでは足りず、数百件を連続で叩き続けると403/429が数分間
// ブロックされる形で発生することを確認済み(utils/itunes.tsのコメント参照)。
export function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('403') || message.includes('429')
}
