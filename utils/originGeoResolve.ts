// utils/originGeoResolve.ts
//
// アーティストの出身地座標(origin_latitude/longitude)を、地図の塗りつぶし表示用の
// 構造化コードへ解決する。国土地理院(GSI)は日本国内の市区町村コード専用、
// Nominatimは国コード・ISO 3166-2の州地域コードを世界共通で返す。

const NOMINATIM_USER_AGENT = 'MusicSynapse-Dev/1.0 (personal project, origin geo code backfill)'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type NominatimAddress = {
  country_code?: string
  'ISO3166-2-lvl4'?: string
}

export type ResolvedCountryRegion = {
  countryCode: string | null
  regionCode: string | null
}

export function parseNominatimAddress(address: NominatimAddress | undefined): ResolvedCountryRegion {
  if (!address) return { countryCode: null, regionCode: null }
  return {
    countryCode: address.country_code ?? null,
    regionCode: address['ISO3166-2-lvl4'] ?? null,
  }
}

export async function fetchCountryAndRegion(lat: number, lon: number): Promise<ResolvedCountryRegion> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&addressdetails=1`
  const res = await fetch(url, {
    headers: { 'User-Agent': NOMINATIM_USER_AGENT },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    throw new Error(`Nominatim API error: ${res.status}`)
  }
  const data = (await res.json()) as { address?: NominatimAddress }
  return parseNominatimAddress(data.address)
}

export type GsiReverseGeocoderResult = {
  results?: { muniCd?: string; lv01Nm?: string }
}

export function parseGsiMuniCode(data: GsiReverseGeocoderResult | undefined): string | null {
  return data?.results?.muniCd ?? null
}

export async function fetchMuniCode(lat: number, lon: number): Promise<string | null> {
  const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lon=${lon}&lat=${lat}`
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) {
    throw new Error(`GSI API error: ${res.status}`)
  }
  const data = (await res.json()) as GsiReverseGeocoderResult
  return parseGsiMuniCode(data)
}

export { sleep as sleepForRateLimit }
