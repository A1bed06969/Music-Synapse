const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type NominatimResult = {
  latitude: number
  longitude: number
  displayName: string
  country: string | null
  prefectureOrState: string | null
  city: string | null
}

export async function geocodeVenue(venueName: string): Promise<NominatimResult[]> {
  await sleep(1000)
  const url = `${NOMINATIM_BASE}?q=${encodeURIComponent(venueName)}&format=json&addressdetails=1&limit=5`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) {
    throw new Error(`Nominatim API error: ${res.status}`)
  }
  const data = await res.json()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    latitude: Number(r.lat),
    longitude: Number(r.lon),
    displayName: r.display_name,
    // 都道府県相当の階層は国によってstate/provinceのどちらかで返る(日本はprovince)。
    // 市区町村もcity/town/suburbにばらつく(政令指定都市の区はsuburbに入ることがある)。
    country: r.address?.country ?? null,
    prefectureOrState: r.address?.state ?? r.address?.province ?? null,
    city: r.address?.city ?? r.address?.town ?? r.address?.suburb ?? null,
  }))
}

// Nominatimは番地レベルまで含む日本語の詳細住所(例:「東京都渋谷区宇田川町20-1」)を
// ヒットさせられないことが多い(実データで確認済み: 番地入りだと0件、
// 「東京都渋谷区」まで削ると区の代表点がヒットする)。都道府県+市区町村までに
// 削った文字列を返す(それ以上簡略化できない/日本語住所形式でない場合はnull)。
export function simplifyJapaneseAddress(address: string): string | null {
  const match = address.match(/^(.+?[都道府県])(.+?[市区町村])/)
  if (!match) return null
  const simplified = `${match[1]}${match[2]}`
  return simplified !== address.trim() ? simplified : null
}

export type GeocodeWithFallbackResult = {
  results: NominatimResult[]
  /** 詳細住所では0件だったため、都道府県+市区町村レベルまで簡略化して再検索した結果である場合true */
  isApproximate: boolean
}

/**
 * 住所(または都市名・地名)で検索し、0件だった場合は都道府県+市区町村レベルまで
 * 自動的に簡略化して再検索する(代表地点にフォールバックする)。
 */
export async function geocodeWithFallback(query: string): Promise<GeocodeWithFallbackResult> {
  const results = await geocodeVenue(query)
  if (results.length > 0) return { results, isApproximate: false }

  const simplified = simplifyJapaneseAddress(query)
  if (!simplified) return { results: [], isApproximate: false }

  const fallbackResults = await geocodeVenue(simplified)
  return { results: fallbackResults, isApproximate: fallbackResults.length > 0 }
}
