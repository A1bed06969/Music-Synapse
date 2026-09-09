'use server'

import { createClient } from '@/utils/Supabase/server'

export type SearchArtist = { id: string; name: string; name_kana: string | null; name_en: string | null }
export type SearchAlbum = {
  id: string
  title: string
  title_kana: string | null
  jacket_url: string | null
  artist: { id: string; name: string } | null
}
export type SearchTrack = {
  id: string
  title: string
  artist: { id: string; name: string } | null
  album: { id: string; title: string } | null
}

export type SearchResult = {
  artists: SearchArtist[]
  albums: SearchAlbum[]
  tracks: SearchTrack[]
  error: string | null
}

/** アーティスト・アルバム・曲を1往復でまとめて検索する(search_catalog)。
 * 曲名検索はこれまで存在せず、/tracks の絞り込みが唯一の手段だった。
 * track 812,813行への部分一致はILIKEでは間に合わないため、DB側は
 * PGroongaの2-gramインデックスで引いている
 * (supabase/migrations/20260909_add_search_catalog.sql)。
 * メンバー種別のアーティスト(自身名義のリリースが無い人)は
 * browse_kindでDB側から除外済み。 */
export async function search(query: string): Promise<SearchResult> {
  const trimmed = query.trim()
  if (!trimmed) {
    return { artists: [], albums: [], tracks: [], error: null }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('search_catalog', { p_query: trimmed, p_limit: 20 })

  if (error) {
    return { artists: [], albums: [], tracks: [], error: error.message }
  }

  const result = (data ?? {}) as Partial<SearchResult>
  return {
    artists: result.artists ?? [],
    albums: result.albums ?? [],
    tracks: result.tracks ?? [],
    error: null,
  }
}
