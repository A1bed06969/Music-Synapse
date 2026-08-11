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
