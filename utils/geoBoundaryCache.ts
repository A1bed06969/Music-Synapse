// utils/geoBoundaryCache.ts
//
// 市区町村(日本)・州地域(世界)の境界ポリゴンを、DB(geo_boundary)にキャッシュしつつ
// 取得する。無いものだけ都度、外部の無料公開データから取得する。

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveCountryIso } from './artistOriginMap.ts'

const NIIYZ_BASE_URL = 'https://raw.githubusercontent.com/niiyz/JapanCityGeoJson/master/geojson'
// 同リポジトリの50m/110m版はなぜか世界の一部の国(実測で4ヶ国・294件)しか
// 収録されておらず、必ず10m版(4,596件・253国地域、実測で確認済み)を使うこと。
const NATURAL_EARTH_ADMIN1_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson'
// 国レベルの塗りつぶしは、world-countries.json(1:1.1億スケール、大陸集計用の
// メタデータ兼低解像度フォールバック)ではなく、こちらの高解像度版(1:1000万、
// 実測13.3MB・258件)から必要な国だけを取得してキャッシュする。プロパティの
// 大文字小文字はutils/artistOriginMap.tsのresolveCountryIsoが前提とする
// ISO_A2/ISO_A2_EH/ADMIN/CONTINENTの大文字キーと一致(実測で確認済み)。
const NATURAL_EARTH_ADMIN0_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson'

export type GeoBoundaryGeometry = Record<string, unknown>

type NiiyzMunicipalityResponse = {
  features?: { properties?: { N03_004?: string }; geometry?: GeoBoundaryGeometry }[]
}

export async function getOrFetchMunicipalityBoundary(
  supabase: SupabaseClient,
  muniCode: string
): Promise<GeoBoundaryGeometry | null> {
  const { data: existing, error: selectError } = await supabase
    .from('geo_boundary')
    .select('geometry')
    .eq('level', 'municipality')
    .eq('code', muniCode)
    .limit(1)
  if (selectError) {
    console.error(`geo_boundary読み取り失敗(municipality/${muniCode}):`, selectError.message)
  }
  if (existing && existing.length > 0) return existing[0].geometry as GeoBoundaryGeometry

  const prefectureCode = muniCode.slice(0, 2)
  const url = `${NIIYZ_BASE_URL}/${prefectureCode}/${muniCode}.json`
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) return null

  const data = (await res.json()) as NiiyzMunicipalityResponse
  const feature = data.features?.[0]
  if (!feature?.geometry) return null

  const { error: insertError } = await supabase.from('geo_boundary').insert({
    level: 'municipality',
    code: muniCode,
    name: feature.properties?.N03_004 ?? null,
    geometry: feature.geometry,
  })
  if (insertError) {
    console.error(`geo_boundary書き込み失敗(municipality/${muniCode}):`, insertError.message)
  }

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
  const { data: existing, error: selectError } = await supabase
    .from('geo_boundary')
    .select('geometry')
    .eq('level', 'region')
    .eq('code', regionCode)
    .limit(1)
  if (selectError) {
    console.error(`geo_boundary読み取り失敗(region/${regionCode}):`, selectError.message)
  }
  if (existing && existing.length > 0) return existing[0].geometry as GeoBoundaryGeometry

  const feature = preloadedFeatures.find((f) => f.properties.iso_3166_2 === regionCode)
  if (!feature) return null

  const { error: insertError } = await supabase.from('geo_boundary').insert({
    level: 'region',
    code: regionCode,
    name: feature.properties.name ?? null,
    geometry: feature.geometry,
  })
  if (insertError) {
    console.error(`geo_boundary書き込み失敗(region/${regionCode}):`, insertError.message)
  }

  return feature.geometry
}

export type NaturalEarthAdmin0Feature = {
  properties: { ISO_A2?: string; ISO_A2_EH?: string; ADMIN?: string; TYPE?: string }
  geometry: GeoBoundaryGeometry
}

export async function fetchNaturalEarthAdmin0Features(): Promise<NaturalEarthAdmin0Feature[]> {
  const res = await fetch(NATURAL_EARTH_ADMIN0_URL, { signal: AbortSignal.timeout(60000) })
  if (!res.ok) {
    throw new Error(`Natural Earth admin-0 fetch error: ${res.status}`)
  }
  const data = (await res.json()) as { features?: NaturalEarthAdmin0Feature[] }
  return data.features ?? []
}

export async function getOrFetchCountryBoundary(
  supabase: SupabaseClient,
  countryCode: string,
  preloadedFeatures: NaturalEarthAdmin0Feature[]
): Promise<GeoBoundaryGeometry | null> {
  const { data: existing, error: selectError } = await supabase
    .from('geo_boundary')
    .select('geometry')
    .eq('level', 'country')
    .eq('code', countryCode)
    .limit(1)
  if (selectError) {
    console.error(`geo_boundary読み取り失敗(country/${countryCode}):`, selectError.message)
  }
  if (existing && existing.length > 0) return existing[0].geometry as GeoBoundaryGeometry

  // 同じISOコードを複数のfeatureが共有するケースがある(実データで確認済み:
  // フランス本土と、フランスの海外領クリッパートン島が両方ISO_A2_EH="FR")。
  // 本土/主権国を優先し、無ければ最初の候補にフォールバックする。
  const candidates = preloadedFeatures.filter((f) => resolveCountryIso(f.properties) === countryCode)
  const feature = candidates.find((f) => f.properties.TYPE === 'Country' || f.properties.TYPE === 'Sovereign country') ?? candidates[0]
  if (!feature) return null

  const { error: insertError } = await supabase.from('geo_boundary').insert({
    level: 'country',
    code: countryCode,
    name: feature.properties.ADMIN ?? null,
    geometry: feature.geometry,
  })
  if (insertError) {
    console.error(`geo_boundary書き込み失敗(country/${countryCode}):`, insertError.message)
  }

  return feature.geometry
}
