// utils/geoBoundaryCache.ts
//
// 市区町村(日本)・州地域(世界)の境界ポリゴンを、DB(geo_boundary)にキャッシュしつつ
// 取得する。無いものだけ都度、外部の無料公開データから取得する。

import type { SupabaseClient } from '@supabase/supabase-js'

const NIIYZ_BASE_URL = 'https://raw.githubusercontent.com/niiyz/JapanCityGeoJson/master/geojson'
// 同リポジトリの50m/110m版はなぜか世界の一部の国(実測で4ヶ国・294件)しか
// 収録されておらず、必ず10m版(4,596件・253国地域、実測で確認済み)を使うこと。
const NATURAL_EARTH_ADMIN1_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson'

export type GeoBoundaryGeometry = Record<string, unknown>

type NiiyzMunicipalityResponse = {
  features?: { properties?: { N03_004?: string }; geometry?: GeoBoundaryGeometry }[]
}

export async function getOrFetchMunicipalityBoundary(
  supabase: SupabaseClient,
  muniCode: string
): Promise<GeoBoundaryGeometry | null> {
  const { data: existing } = await supabase
    .from('geo_boundary')
    .select('geometry')
    .eq('level', 'municipality')
    .eq('code', muniCode)
    .limit(1)
  if (existing && existing.length > 0) return existing[0].geometry as GeoBoundaryGeometry

  const prefectureCode = muniCode.slice(0, 2)
  const url = `${NIIYZ_BASE_URL}/${prefectureCode}/${muniCode}.json`
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) return null

  const data = (await res.json()) as NiiyzMunicipalityResponse
  const feature = data.features?.[0]
  if (!feature?.geometry) return null

  await supabase.from('geo_boundary').insert({
    level: 'municipality',
    code: muniCode,
    name: feature.properties?.N03_004 ?? null,
    geometry: feature.geometry,
  })

  return feature.geometry
}

export type NaturalEarthAdmin1Feature = {
  properties: { iso_3166_2?: string; name?: string }
  geometry: GeoBoundaryGeometry
}

export async function fetchNaturalEarthAdmin1Features(): Promise<NaturalEarthAdmin1Feature[]> {
  const res = await fetch(NATURAL_EARTH_ADMIN1_URL, { signal: AbortSignal.timeout(120000) })
  if (!res.ok) {
    throw new Error(`Natural Earth admin-1 fetch error: ${res.status}`)
  }
  const data = (await res.json()) as { features?: NaturalEarthAdmin1Feature[] }
  return data.features ?? []
}

export async function getOrFetchRegionBoundary(
  supabase: SupabaseClient,
  regionCode: string,
  preloadedFeatures: NaturalEarthAdmin1Feature[]
): Promise<GeoBoundaryGeometry | null> {
  const { data: existing } = await supabase
    .from('geo_boundary')
    .select('geometry')
    .eq('level', 'region')
    .eq('code', regionCode)
    .limit(1)
  if (existing && existing.length > 0) return existing[0].geometry as GeoBoundaryGeometry

  const feature = preloadedFeatures.find((f) => f.properties.iso_3166_2 === regionCode)
  if (!feature) return null

  await supabase.from('geo_boundary').insert({
    level: 'region',
    code: regionCode,
    name: feature.properties.name ?? null,
    geometry: feature.geometry,
  })

  return feature.geometry
}
