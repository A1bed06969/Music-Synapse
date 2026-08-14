// 国土地理院(GSI)の住所検索API。認証不要・無料で、日本の住所を番地レベルまで
// 高精度にジオコーディングできる(Nominatimが「東京都渋谷区宇田川町20-1」のような
// 実在の住所を0件で返すケースで、GSIは建物番号まで正確にヒットすることを実データで確認済み)。
// 日本国内の住所専用(海外住所は対象外)。
const GSI_BASE = 'https://msearch.gsi.go.jp/address-search/AddressSearch'
const USER_AGENT = 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'

export type GsiResult = {
  latitude: number
  longitude: number
  title: string
}

export async function geocodeJapaneseAddress(query: string): Promise<GsiResult[]> {
  const url = `${GSI_BASE}?q=${encodeURIComponent(query)}`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) {
    throw new Error(`GSI API error: ${res.status}`)
  }
  const data = await res.json()
  return (data ?? []).map(
    (r: { geometry: { coordinates: [number, number] }; properties: { title: string } }) => ({
      longitude: r.geometry.coordinates[0],
      latitude: r.geometry.coordinates[1],
      title: r.properties.title,
    })
  )
}

/** タイトルの先頭が「都道府県+市区町村」だけで終わっている(番地等の詳細が無い)場合true */
export function isCityLevelOnlyTitle(title: string): boolean {
  return /^.+?[都道府県].+?[市区町村]$/.test(title)
}

export function parseJapanesePrefectureCity(title: string): { prefecture: string | null; city: string | null } {
  const match = title.match(/^(.+?[都道府県])(.+?[市区町村])/)
  if (!match) return { prefecture: null, city: null }
  return { prefecture: match[1], city: match[2] }
}
