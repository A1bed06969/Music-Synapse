import type { SupabaseClient } from '@supabase/supabase-js'

/** Music Planet Tour の「都市」(place)。出身アーティストを都市でたどるためのデータ */
export type Place = {
  id: string
  name: string
  nameJa: string | null
  countryCode: string
  adminName: string | null
  latitude: number
  longitude: number
}
export type PlaceArtist = { id: string; name: string; imageUrl: string | null; firstYear: number | null; albumCount: number }
export type PlaceCount = { id: string; name: string; nameJa: string | null; countryCode: string; latitude: number; longitude: number; artistCount: number }

/** 表示名: 日本語名があればそれ(「大阪市」→「大阪」のように末尾の市は外す) */
export function placeLabel(p: { name: string; nameJa: string | null }): string {
  if (!p.nameJa) return p.name
  return p.nameJa.replace(/(?<=..)(市|特別市)$/, '')
}

const countryNames = new Intl.DisplayNames(['ja'], { type: 'region' })
export function countryLabel(code: string | null | undefined): string {
  if (!code) return ''
  try {
    return countryNames.of(code.toUpperCase()) ?? code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

function toPlace(r: Record<string, unknown>): Place {
  return {
    id: r.id as string,
    name: r.name as string,
    nameJa: (r.name_ja as string | null) ?? null,
    countryCode: r.country_code as string,
    adminName: (r.admin_name as string | null) ?? null,
    latitude: r.latitude as number,
    longitude: r.longitude as number,
  }
}

export async function fetchPlace(supabase: SupabaseClient, id: string): Promise<Place | null> {
  const { data } = await supabase.from('place').select('id, name, name_ja, country_code, admin_name, latitude, longitude').eq('id', id).maybeSingle()
  return data ? toPlace(data) : null
}

/** 都市の出身アーティスト(最初のリリース年の順) */
export async function fetchPlaceArtists(supabase: SupabaseClient, placeId: string): Promise<PlaceArtist[]> {
  const { data } = await supabase.rpc('place_artists', { p_place_id: placeId })
  return ((data ?? []) as { id: string; name: string; image_url: string | null; first_year: number | null; album_count: number }[]).map((r) => ({
    id: r.id,
    name: r.name,
    imageUrl: r.image_url,
    firstYear: r.first_year,
    albumCount: r.album_count,
  }))
}

export async function fetchPlaceTopGenres(supabase: SupabaseClient, placeId: string, limit = 6): Promise<{ id: string; name: string; count: number }[]> {
  const { data } = await supabase.rpc('place_top_genres', { p_place_id: placeId, p_limit: limit })
  return ((data ?? []) as { genre_id: string; name: string; artist_count: number }[]).map((r) => ({ id: r.genre_id, name: r.name, count: r.artist_count }))
}

/** 都市ごとの出身アーティスト数(多い順)。countryCode を渡すとその国だけ */
export async function fetchPlaceCounts(supabase: SupabaseClient, countryCode?: string): Promise<PlaceCount[]> {
  const rows: PlaceCount[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.rpc('place_artist_counts', { p_country_code: countryCode ?? null }).range(from, from + 999)
    const page = (data ?? []) as { place_id: string; name: string; name_ja: string | null; country_code: string; latitude: number; longitude: number; artist_count: number }[]
    rows.push(...page.map((r) => ({ id: r.place_id, name: r.name, nameJa: r.name_ja, countryCode: r.country_code, latitude: r.latitude, longitude: r.longitude, artistCount: r.artist_count })))
    if (page.length < 1000) break
  }
  return rows
}

/** 年代ごとに分ける(最初のリリース年が無いものは「年代不明」) */
export function groupByDecade(artists: PlaceArtist[]): { label: string; artists: PlaceArtist[] }[] {
  const groups = new Map<string, PlaceArtist[]>()
  for (const a of artists) {
    const label = a.firstYear ? `${Math.floor(a.firstYear / 10) * 10}s` : '年代不明'
    groups.set(label, [...(groups.get(label) ?? []), a])
  }
  return [...groups.entries()].map(([label, list]) => ({ label, artists: list }))
}
