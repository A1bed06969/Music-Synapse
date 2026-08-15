'use server'

import { createClient } from '@/utils/Supabase/server'
import { getMemberArtistIdsAmong } from '@/utils/artistPageKind'

export async function search(query: string) {
  const trimmed = query.trim()
  if (!trimmed) {
    return { artists: [], albums: [], error: null }
  }

  const supabase = await createClient()

  const [artistResult, albumResult] = await Promise.all([
    supabase
      .from('artist')
      .select('id, name, name_kana, name_en')
      .ilike('name', `%${trimmed}%`)
      .limit(40),
    supabase
      .from('album')
      .select('id, title, title_kana, jacket_url, artist:artist_id(id, name)')
      .ilike('title', `%${trimmed}%`)
      .limit(20),
  ])

  if (artistResult.error) {
    return { artists: [], albums: [], error: artistResult.error.message }
  }

  const candidateIds = (artistResult.data ?? []).map((a) => a.id)
  const memberIds = await getMemberArtistIdsAmong(supabase, candidateIds)
  const artists = (artistResult.data ?? []).filter((a) => !memberIds.has(a.id)).slice(0, 20)

  if (albumResult.error) {
    return { artists, albums: [], error: albumResult.error.message }
  }

  return { artists, albums: albumResult.data, error: null }
}
