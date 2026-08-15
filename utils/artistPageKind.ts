import type { SupabaseClient } from '@supabase/supabase-js'

export type ArtistPageKind = 'artist' | 'member'

export function resolveArtistPageKind(pageOverride: string | null, ownsRelease: boolean): ArtistPageKind {
  if (pageOverride === 'artist' || pageOverride === 'member') {
    return pageOverride
  }
  return ownsRelease ? 'artist' : 'member'
}

export async function hasOwnRelease(supabase: SupabaseClient, artistId: string): Promise<boolean> {
  const [{ count: albumCount }, { count: trackCount }] = await Promise.all([
    supabase.from('album').select('id', { count: 'exact', head: true }).eq('artist_id', artistId),
    supabase.from('track').select('id', { count: 'exact', head: true }).eq('artist_id', artistId),
  ])
  return (albumCount ?? 0) > 0 || (trackCount ?? 0) > 0
}

async function fetchAllArtistIds(supabase: SupabaseClient, table: 'album' | 'track'): Promise<string[]> {
  const ids: string[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data } = await supabase.from(table).select('artist_id').range(offset, offset + pageSize - 1)
    const rows = data ?? []
    for (const row of rows) {
      if (row.artist_id) ids.push(row.artist_id)
    }
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return ids
}

export async function getMemberArtistIds(supabase: SupabaseClient): Promise<Set<string>> {
  const [{ data: allArtists }, albumArtistIds, trackArtistIds] = await Promise.all([
    supabase.from('artist').select('id, page_override'),
    fetchAllArtistIds(supabase, 'album'),
    fetchAllArtistIds(supabase, 'track'),
  ])

  const releasedIds = new Set<string>([...albumArtistIds, ...trackArtistIds])

  const memberIds = new Set<string>()
  for (const artist of allArtists ?? []) {
    if (resolveArtistPageKind(artist.page_override, releasedIds.has(artist.id)) === 'member') {
      memberIds.add(artist.id)
    }
  }
  return memberIds
}
