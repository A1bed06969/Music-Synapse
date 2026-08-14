import { geocodeJapaneseAddress, isCityLevelOnlyTitle, parseJapanesePrefectureCity } from '@/utils/gsi'

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
  /** どちらのジオコーダーが結果を返したか(DBのsource列に記録する用途) */
  source: 'gsi' | 'nominatim'
}

/**
 * 住所(または都市名・地名)で検索する。
 * ① まず国土地理院(GSI)で検索する。日本の住所を番地レベルまで高精度に
 *    ジオコーディングできるため(Nominatimは同じ住所で0件になることが多い、
 *    実データで確認済み)、日本国内の住所はこちらを優先する。
 * ② GSIで0件だった場合(海外の住所等、GSIの対象外)はNominatimにフォールバックする。
 * ③ Nominatimも0件だった場合は都道府県+市区町村レベルまで簡略化して再検索する
 *    (代表地点へのフォールバック)。
 */
export async function geocodeWithFallback(query: string): Promise<GeocodeWithFallbackResult> {
  const gsiResults = await geocodeJapaneseAddress(query)
  if (gsiResults.length > 0) {
    const results: NominatimResult[] = gsiResults.map((r) => {
      const { prefecture, city } = parseJapanesePrefectureCity(r.title)
      return {
        latitude: r.latitude,
        longitude: r.longitude,
        displayName: r.title,
        country: '日本',
        prefectureOrState: prefecture,
        city,
      }
    })
    return { results, isApproximate: gsiResults.every((r) => isCityLevelOnlyTitle(r.title)), source: 'gsi' }
  }

  const results = await geocodeVenue(query)
  if (results.length > 0) return { results, isApproximate: false, source: 'nominatim' }

  const simplified = simplifyJapaneseAddress(query)
  if (!simplified) return { results: [], isApproximate: false, source: 'nominatim' }

  const fallbackResults = await geocodeVenue(simplified)
  return { results: fallbackResults, isApproximate: fallbackResults.length > 0, source: 'nominatim' }
}
