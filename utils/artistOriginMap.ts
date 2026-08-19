// utils/artistOriginMap.ts
//
// アーティスト出身地マップの大陸/国レベルの集計ロジック。世界の国境データ
// (Natural Earth admin-0, public/geo/world-countries.json)のCONTINENT属性を
// そのまま使うことで、既存のutils/continents.ts(自由入力の国名文字列ベースで
// カバレッジに漏れがある)には依存しない、コード起点の頑健な大陸判定を行う。

export type NaturalEarthCountryFeature = {
  properties: { ISO_A2?: string; CONTINENT?: string; ADMIN?: string }
  geometry: Record<string, unknown>
}

export const CONTINENT_ORDER = ['アジア', 'ヨーロッパ', '北米', '南米', 'オセアニア', 'アフリカ', 'その他'] as const

const CONTINENT_LABEL_JA: Record<string, string> = {
  Asia: 'アジア',
  Europe: 'ヨーロッパ',
  'North America': '北米',
  'South America': '南米',
  Oceania: 'オセアニア',
  Africa: 'アフリカ',
}

/** 大陸ラベルの目安表示位置(世界地図初期表示でのマーカー位置)。緯度経度は
 * 各大陸のおおよその重心を手動で決めた値(実装時に妥当な値を決める、という
 * 元設計の申し送り事項への対応)。 */
export const CONTINENT_CENTER: Record<string, [number, number]> = {
  アジア: [34, 100],
  ヨーロッパ: [54, 15],
  北米: [45, -100],
  南米: [-15, -60],
  オセアニア: [-25, 140],
  アフリカ: [2, 20],
}

export function buildCountryToContinentMap(features: NaturalEarthCountryFeature[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const feature of features) {
    const iso = feature.properties.ISO_A2?.toLowerCase()
    const continent = feature.properties.CONTINENT
    if (!iso || !continent) continue
    map.set(iso, CONTINENT_LABEL_JA[continent] ?? 'その他')
  }
  return map
}

export type ContinentCount = { continent: string; artistCount: number }

export function groupArtistsByContinent(
  artists: { countryCode: string | null }[],
  countryToContinent: Map<string, string>
): ContinentCount[] {
  const counts = new Map<string, number>()
  for (const artist of artists) {
    if (!artist.countryCode) continue
    const continent = countryToContinent.get(artist.countryCode.toLowerCase()) ?? 'その他'
    counts.set(continent, (counts.get(continent) ?? 0) + 1)
  }
  return CONTINENT_ORDER.filter((continent) => counts.has(continent)).map((continent) => ({
    continent,
    artistCount: counts.get(continent)!,
  }))
}

export type CountryCount = { countryCode: string; artistCount: number }

export function groupArtistsByCountry(
  artists: { countryCode: string | null }[],
  continent: string,
  countryToContinent: Map<string, string>
): CountryCount[] {
  const counts = new Map<string, number>()
  for (const artist of artists) {
    if (!artist.countryCode) continue
    const code = artist.countryCode.toLowerCase()
    const artistContinent = countryToContinent.get(code) ?? 'その他'
    if (artistContinent !== continent) continue
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([countryCode, artistCount]) => ({ countryCode, artistCount }))
    .sort((a, b) => b.artistCount - a.artistCount)
}
