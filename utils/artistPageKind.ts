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

export async function getMemberArtistIds(supabase: SupabaseClient): Promise<Set<string>> {
  const [{ data: allArtists }, { data: albumRows }, { data: trackRows }] = await Promise.all([
    supabase.from('artist').select('id, page_override'),
    supabase.from('album').select('artist_id'),
    supabase.from('track').select('artist_id'),
  ])

  const releasedIds = new Set<string>()
  for (const row of albumRows ?? []) releasedIds.add(row.artist_id)
  for (const row of trackRows ?? []) {
    if (row.artist_id) releasedIds.add(row.artist_id)
  }

  const memberIds = new Set<string>()
  for (const artist of allArtists ?? []) {
    if (resolveArtistPageKind(artist.page_override, releasedIds.has(artist.id)) === 'member') {
      memberIds.add(artist.id)
    }
  }
  return memberIds
}
