'use server'

import { createClient } from '@/utils/Supabase/server'

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
      .limit(20),
    supabase
      .from('album')
      .select('id, title, title_kana, jacket_url, artist:artist_id(id, name)')
      .ilike('title', `%${trimmed}%`)
      .limit(20),
  ])

  if (artistResult.error) {
    return { artists: [], albums: [], error: artistResult.error.message }
  }
  if (albumResult.error) {
    return { artists: artistResult.data, albums: [], error: albumResult.error.message }
  }

  return { artists: artistResult.data, albums: albumResult.data, error: null }
}
