// パワープレイ&ヘビロテの集計周期は局によって固定(週間 or 月間)で、
// データからは判別できないため局名で決め打ちする。
const WEEKLY_STATIONS = new Set(['秋田放送', 'TBSラジオ', 'ベイエフエム', '山梨放送'])

export function getStationPeriodType(stationName: string): 'weekly' | 'monthly' {
  return WEEKLY_STATIONS.has(stationName) ? 'weekly' : 'monthly'
}
