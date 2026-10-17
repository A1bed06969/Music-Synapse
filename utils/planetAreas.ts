// ④Music Planet Tour のエリア区分と表示名(サーバー・ブラウザの両方で使う)
export type PlanetArea = 'japan' | 'asia' | 'europe' | 'northAmerica' | 'latinAmerica' | 'africa' | 'oceania'
export const PLANET_AREA_LABEL: Record<PlanetArea, string> = {
  japan: '日本',
  asia: 'アジア',
  europe: 'ヨーロッパ',
  northAmerica: '北米',
  latinAmerica: '中南米',
  africa: 'アフリカ',
  oceania: 'オセアニア',
}
