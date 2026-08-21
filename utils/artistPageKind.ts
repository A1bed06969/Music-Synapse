import type { SupabaseClient } from '@supabase/supabase-js'

export type ArtistPageKind = 'artist' | 'member'

export function resolveArtistPageKind(
  pageOverride: string | null,
  isMember: boolean,
  ownsRelease: boolean
): ArtistPageKind {
  if (pageOverride === 'artist' || pageOverride === 'member') {
    return pageOverride
  }
  if (!isMember) return 'artist'
  return ownsRelease ? 'artist' : 'member'
}

export async function hasOwnRelease(supabase: SupabaseClient, artistId: string): Promise<boolean> {
  const [{ count: albumCount }, { count: trackCount }, { count: coArtistCount }] = await Promise.all([
    supabase.from('album').select('id', { count: 'exact', head: true }).eq('artist_id', artistId),
    supabase.from('track').select('id', { count: 'exact', head: true }).eq('artist_id', artistId),
    supabase.from('album_artist').select('id', { count: 'exact', head: true }).eq('artist_id', artistId),
  ])
  return (albumCount ?? 0) > 0 || (trackCount ?? 0) > 0 || (coArtistCount ?? 0) > 0
}

async function fetchAllArtistIds(supabase: SupabaseClient, table: 'album' | 'track' | 'album_artist'): Promise<Set<string>> {
  const ids = new Set<string>()
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from(table)
      .select('artist_id')
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    const rows = data ?? []
    for (const row of rows) {
      if (row.artist_id) ids.add(row.artist_id)
    }
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return ids
}

async function fetchMemberOfIds(supabase: SupabaseClient): Promise<Set<string>> {
  const { data } = await supabase.from('artist_relation').select('artist_id_b').eq('relation_type', 'membership')
  const ids = new Set<string>()
  for (const row of data ?? []) {
    if (row.artist_id_b) ids.add(row.artist_id_b)
  }
  return ids
}

export async function getMemberArtistIds(supabase: SupabaseClient): Promise<Set<string>> {
  const [{ data: allArtists }, albumArtistIds, trackArtistIds, coArtistLinkIds, memberOfIds] = await Promise.all([
    supabase.from('artist').select('id, page_override'),
    fetchAllArtistIds(supabase, 'album'),
    fetchAllArtistIds(supabase, 'track'),
    fetchAllArtistIds(supabase, 'album_artist'),
    fetchMemberOfIds(supabase),
  ])

  const releasedIds = new Set<string>([...albumArtistIds, ...trackArtistIds, ...coArtistLinkIds])

  const memberIds = new Set<string>()
  for (const artist of allArtists ?? []) {
    const kind = resolveArtistPageKind(artist.page_override, memberOfIds.has(artist.id), releasedIds.has(artist.id))
    if (kind === 'member') memberIds.add(artist.id)
  }
  return memberIds
}

export async function getMemberArtistIdsAmong(supabase: SupabaseClient, candidateIds: string[]): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set()

  const [{ data: candidates }, { data: albumRows }, { data: trackRows }, { data: coArtistRows }, { data: membershipRows }] = await Promise.all([
    supabase.from('artist').select('id, page_override').in('id', candidateIds),
    supabase.from('album').select('artist_id').in('artist_id', candidateIds),
    supabase.from('track').select('artist_id').in('artist_id', candidateIds),
    supabase.from('album_artist').select('artist_id').in('artist_id', candidateIds),
    supabase
      .from('artist_relation')
      .select('artist_id_b')
      .eq('relation_type', 'membership')
      .in('artist_id_b', candidateIds),
  ])

  const releasedIds = new Set<string>()
  for (const row of albumRows ?? []) {
    if (row.artist_id) releasedIds.add(row.artist_id)
  }
  for (const row of trackRows ?? []) {
    if (row.artist_id) releasedIds.add(row.artist_id)
  }
  for (const row of coArtistRows ?? []) {
    if (row.artist_id) releasedIds.add(row.artist_id)
  }

  const memberOfIds = new Set<string>()
  for (const row of membershipRows ?? []) {
    if (row.artist_id_b) memberOfIds.add(row.artist_id_b)
  }

  const memberIds = new Set<string>()
  for (const artist of candidates ?? []) {
    const kind = resolveArtistPageKind(artist.page_override, memberOfIds.has(artist.id), releasedIds.has(artist.id))
    if (kind === 'member') memberIds.add(artist.id)
  }
  return memberIds
}
