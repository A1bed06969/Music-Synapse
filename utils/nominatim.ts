const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type NominatimResult = {
  latitude: number
  longitude: number
  displayName: string
}

export async function geocodeVenue(venueName: string): Promise<NominatimResult[]> {
  await sleep(1000)
  const url = `${NOMINATIM_BASE}?q=${encodeURIComponent(venueName)}&format=json&limit=5`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) {
    throw new Error(`Nominatim API error: ${res.status}`)
  }
  const data = await res.json()
  return (data ?? []).map((r: any) => ({
    latitude: Number(r.lat),
    longitude: Number(r.lon),
    displayName: r.display_name,
  }))
}
