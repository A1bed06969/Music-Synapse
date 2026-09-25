// パワープレイ&ヘビロテの集計周期は局によって固定(週間 or 月間)で、
// データからは判別できないため局名で決め打ちする。
const WEEKLY_STATIONS = new Set(['秋田放送', 'TBSラジオ', 'ベイエフエム', '山梨放送'])

export function getStationPeriodType(stationName: string): 'weekly' | 'monthly' {
  return WEEKLY_STATIONS.has(stationName) ? 'weekly' : 'monthly'
}

/** エフエム愛知の「monthly album recommend」やタワーレコードの「タワレコメン」は
 * 個別トラックではなくアルバム単位の選出のため、局名またはcampaign_nameの表記で
 * トラック検索/アルバム検索を切り替える判定に使う。
 *
 * 実際の事故(2026-09-19): エフエム愛知はcampaign_nameに「アルバム単位」という
 * 目印を含めることを前提にしていたが、Gemini抽出(①の自動収集)は局サイトに
 * 表示されている企画名(例:「monthly album recommend」)をそのまま拾うだけで、
 * この目印を付与する指示は無かった。結果、この局の全ピックがトラック検索扱いに
 * なり、実際のアルバムではなく同アーティストの無関係なトラックに誤マッチした
 * まま登録されていた。局名ベースの判定を主にし、campaign_nameの目印は
 * (将来手動で付与された場合のための)補助的な判定として残す。 */
const ALBUM_CAMPAIGN_STATIONS = new Set(['エフエム愛知'])

export function isAlbumCampaign(stationName: string, campaignName: string | null): boolean {
  if (ALBUM_CAMPAIGN_STATIONS.has(stationName)) return true
  return !!campaignName && campaignName.includes('アルバム単位')
}
