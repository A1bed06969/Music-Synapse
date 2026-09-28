// utils/countryFromCoordinates.ts
//
// 緯度経度から国コード(ISO_A2、小文字)を逆引きする。外部の逆ジオコーディングAPIを
// 使わず、既に同梱しているpublic/geo/world-countries.json(Natural Earth)の
// ポリゴンに対してPoint-in-Polygon判定(レイキャスティング法)を行うことで、
// 追加のAPI呼び出し・レート制限無しにローカルだけで解決できる。
// utils/artistOriginMap.tsのresolveCountryIsoと同じISO解決ロジックを踏襲する
// (origin_country_codeはこの値と同じ形式で保存する)。
import { readFileSync } from 'fs'
import path from 'path'

type Ring = [number, number][]
type PolygonGeom = Ring[]
type MultiPolygonGeom = PolygonGeom[]

type CountryPolygonFeature = {
  iso2: string
  bbox: [number, number, number, number] // [minLng, minLat, maxLng, maxLat]
  polygons: MultiPolygonGeom
}

function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function pointInPolygon(lng: number, lat: number, polygon: PolygonGeom): boolean {
  if (polygon.length === 0 || !pointInRing(lng, lat, polygon[0])) return false
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(lng, lat, polygon[i])) return false // 穴(内陸国等の飛び地の穴)の中なので国外扱い
  }
  return true
}

function computeBbox(polygons: MultiPolygonGeom): [number, number, number, number] {
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }
    }
  }
  return [minLng, minLat, maxLng, maxLat]
}

let cachedCountries: CountryPolygonFeature[] | null = null

function loadCountryPolygons(): CountryPolygonFeature[] {
  if (cachedCountries) return cachedCountries

  const raw = readFileSync(path.join(process.cwd(), 'public/geo/world-countries.json'), 'utf-8')
  const geojson = JSON.parse(raw) as {
    features: { properties: { ISO_A2?: string; ISO_A2_EH?: string }; geometry: { type: string; coordinates: unknown } }[]
  }

  const result: CountryPolygonFeature[] = []
  for (const feature of geojson.features) {
    const isoRaw = feature.properties.ISO_A2_EH ?? feature.properties.ISO_A2
    if (!isoRaw || isoRaw === '-99') continue
    const iso2 = isoRaw.toLowerCase()

    let polygons: MultiPolygonGeom
    if (feature.geometry.type === 'Polygon') {
      polygons = [feature.geometry.coordinates as PolygonGeom]
    } else if (feature.geometry.type === 'MultiPolygon') {
      polygons = feature.geometry.coordinates as MultiPolygonGeom
    } else {
      continue
    }

    result.push({ iso2, bbox: computeBbox(polygons), polygons })
  }
  cachedCountries = result
  return result
}

/** 緯度経度がどの国のポリゴン内に収まるかを解決する(見つからなければnull)。
 * 各国の外接矩形(bbox)で先に絞り込んでから実際のポリゴン判定を行うことで、
 * 177カ国 x 数千件規模でも一括バックフィルに耐えられる速度にしている。 */
export function resolveCountryCodeFromCoordinates(latitude: number, longitude: number): string | null {
  const countries = loadCountryPolygons()
  for (const country of countries) {
    const [minLng, minLat, maxLng, maxLat] = country.bbox
    if (longitude < minLng || longitude > maxLng || latitude < minLat || latitude > maxLat) continue
    for (const polygon of country.polygons) {
      if (pointInPolygon(longitude, latitude, polygon)) return country.iso2
    }
  }
  return null
}
