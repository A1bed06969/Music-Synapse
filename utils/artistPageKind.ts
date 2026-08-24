import type { SupabaseClient } from '@supabase/supabase-js'

export type ArtistPageKind = 'artist' | 'member'

/**
 * 自身の名義でのリリース(album/track/album_artist経由)が無いアーティストは、
 * バンドメンバーかどうかを問わず「member」種別(ディスコグラフィーの無い簡易
 * プロフィールページ)として扱う。以前はartist_relation.membershipを持つ場合
 * だけをこの対象にしていたが、MusicBrainzの関連アーティスト取込はmembership
 * 以外の関係(collaboration等)でも大量のスタブartist行(本人名義のリリースを
 * 一切持たない)を作るため、それらがアーティスト一覧・検索・マップに紛れ込む
 * 不具合があった。判定基準を「自身のリリースの有無」のみに一本化することで、
 * 関係の種類やスタブの作られ方を問わず自動的に振り分けられるようにする。
 */
export function resolveArtistPageKind(pageOverride: string | null, ownsRelease: boolean): ArtistPageKind {
  if (pageOverride === 'artist' || pageOverride === 'member') {
    return pageOverride
  }
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

export async function getMemberArtistIds(supabase: SupabaseClient): Promise<Set<string>> {
  const [{ data: allArtists }, albumArtistIds, trackArtistIds, coArtistLinkIds] = await Promise.all([
    supabase.from('artist').select('id, page_override'),
    fetchAllArtistIds(supabase, 'album'),
    fetchAllArtistIds(supabase, 'track'),
    fetchAllArtistIds(supabase, 'album_artist'),
  ])

  const releasedIds = new Set<string>([...albumArtistIds, ...trackArtistIds, ...coArtistLinkIds])

  const memberIds = new Set<string>()
  for (const artist of allArtists ?? []) {
    const kind = resolveArtistPageKind(artist.page_override, releasedIds.has(artist.id))
    if (kind === 'member') memberIds.add(artist.id)
  }
  return memberIds
}

export async function getMemberArtistIdsAmong(supabase: SupabaseClient, candidateIds: string[]): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set()

  const [{ data: candidates }, { data: albumRows }, { data: trackRows }, { data: coArtistRows }] = await Promise.all([
    supabase.from('artist').select('id, page_override').in('id', candidateIds),
    supabase.from('album').select('artist_id').in('artist_id', candidateIds),
    supabase.from('track').select('artist_id').in('artist_id', candidateIds),
    supabase.from('album_artist').select('artist_id').in('artist_id', candidateIds),
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

  const memberIds = new Set<string>()
  for (const artist of candidates ?? []) {
    const kind = resolveArtistPageKind(artist.page_override, releasedIds.has(artist.id))
    if (kind === 'member') memberIds.add(artist.id)
  }
  return memberIds
}
