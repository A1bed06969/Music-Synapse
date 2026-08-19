// utils/artistOriginBoundary.ts
//
// origin_region_code/origin_muni_codeが設定されていても、対応するgeo_boundary
// 行が無い場合がある(実データで確認済み: Nominatim/Natural Earthの粒度差により
// 英国・フランスの一部地域は永続的にポリゴンが存在しない)。このモジュールは
// 「実際に塗りつぶし可能な最も細かいレベルはどこか」を、コード自体の有無ではなく
// geo_boundaryに実在するコードの集合と突き合わせて決める。

export type BoundaryCodeSet = {
  municipalityCodes: Set<string>
  regionCodes: Set<string>
}

export function hasBoundaryDataForCountry(
  artistsInCountry: { regionCode: string | null; muniCode: string | null }[],
  cached: BoundaryCodeSet
): boolean {
  return artistsInCountry.some(
    (artist) =>
      (artist.muniCode !== null && cached.municipalityCodes.has(artist.muniCode)) ||
      (artist.regionCode !== null && cached.regionCodes.has(artist.regionCode))
  )
}

export type ArtistOriginTarget =
  | { level: 'municipality'; code: string }
  | { level: 'region'; code: string }
  | { level: 'country'; code: string }
  | { level: 'point' }

export function resolveArtistTarget(
  artist: { countryCode: string | null; regionCode: string | null; muniCode: string | null },
  cached: BoundaryCodeSet
): ArtistOriginTarget {
  if (artist.muniCode !== null && cached.municipalityCodes.has(artist.muniCode)) {
    return { level: 'municipality', code: artist.muniCode }
  }
  if (artist.regionCode !== null && cached.regionCodes.has(artist.regionCode)) {
    return { level: 'region', code: artist.regionCode }
  }
  if (artist.countryCode !== null) {
    return { level: 'country', code: artist.countryCode }
  }
  return { level: 'point' }
}
