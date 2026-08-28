// パワープレイ&ヘビロテの集計周期は局によって固定(週間 or 月間)で、
// データからは判別できないため局名で決め打ちする。
const WEEKLY_STATIONS = new Set(['秋田放送', 'TBSラジオ', 'ベイエフエム', '山梨放送'])

export function getStationPeriodType(stationName: string): 'weekly' | 'monthly' {
  return WEEKLY_STATIONS.has(stationName) ? 'weekly' : 'monthly'
}

/** エフエム愛知の「monthly album recommend」やタワーレコードの「タワレコメン」は
 * 個別トラックではなくアルバム単位の選出のため、campaign_nameの表記でトラック検索/
 * アルバム検索を切り替える判定に使う */
export function isAlbumCampaign(campaignName: string | null): boolean {
  return !!campaignName && campaignName.includes('アルバム単位')
}
