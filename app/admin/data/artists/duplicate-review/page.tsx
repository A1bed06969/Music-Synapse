import { createAdminClient } from '@/utils/Supabase/admin'
import DuplicateReviewClient, { type DuplicateGroup } from './DuplicateReviewClient'

// 「Various Artists」はコンピレーション盤で汎用的に使われる名義で、複数の
// apple_music_artist_idが存在するのが正常(=重複ではない)ため最初から除外する
const EXCLUDED_NAMES = new Set(['Various Artists', 'ヴァリアス・アーティスト'])

type ArtistRow = { id: string; name: string; apple_music_artist_id: string | null; created_at: string }

async function fetchAllArtists(supabase: ReturnType<typeof createAdminClient>): Promise<ArtistRow[]> {
  const rows: ArtistRow[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('artist')
      .select('id, name, apple_music_artist_id, created_at')
      .order('name', { ascending: true })
      .range(offset, offset + pageSize - 1)
    const page = (data ?? []) as ArtistRow[]
    rows.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }
  return rows
}

export default async function DuplicateReviewPage() {
  const supabase = createAdminClient()

  const [allArtists, { data: reviewedRows }] = await Promise.all([
    fetchAllArtists(supabase),
    supabase.from('artist_duplicate_review').select('artist_name'),
  ])
  const reviewedNames = new Set((reviewedRows ?? []).map((r) => r.artist_name))

  const byName = new Map<string, ArtistRow[]>()
  for (const row of allArtists) {
    if (EXCLUDED_NAMES.has(row.name) || reviewedNames.has(row.name)) continue
    byName.set(row.name, [...(byName.get(row.name) ?? []), row])
  }

  const ambiguousGroups = Array.from(byName.entries()).filter(([, rows]) => {
    const distinctAppleIds = new Set(rows.map((r) => r.apple_music_artist_id).filter((v): v is string => !!v))
    return rows.length > 1 && distinctAppleIds.size > 1
  })

  const allArtistIds = ambiguousGroups.flatMap(([, rows]) => rows.map((r) => r.id))

  if (allArtistIds.length === 0) {
    return <DuplicateReviewClient groups={[]} />
  }

  const [{ data: albumCounts }, { data: trackCounts }, { data: sampleAlbums }] = await Promise.all([
    supabase.from('album').select('artist_id').in('artist_id', allArtistIds),
    supabase.from('track').select('artist_id').in('artist_id', allArtistIds),
    supabase
      .from('album')
      .select('artist_id, title, jacket_url, release_date')
      .in('artist_id', allArtistIds)
      .order('release_date', { ascending: false }),
  ])

  const albumCountByArtist = new Map<string, number>()
  for (const a of albumCounts ?? []) albumCountByArtist.set(a.artist_id, (albumCountByArtist.get(a.artist_id) ?? 0) + 1)
  const trackCountByArtist = new Map<string, number>()
  for (const t of trackCounts ?? []) trackCountByArtist.set(t.artist_id, (trackCountByArtist.get(t.artist_id) ?? 0) + 1)
  const sampleAlbumByArtist = new Map<string, { title: string; jacketUrl: string | null }>()
  for (const a of sampleAlbums ?? []) {
    if (!sampleAlbumByArtist.has(a.artist_id)) sampleAlbumByArtist.set(a.artist_id, { title: a.title, jacketUrl: a.jacket_url })
  }

  const groups: DuplicateGroup[] = ambiguousGroups
    .map(([name, rows]) => ({
      name,
      candidates: rows
        .slice()
        .sort((a, b) => (trackCountByArtist.get(b.id) ?? 0) - (trackCountByArtist.get(a.id) ?? 0))
        .map((r) => ({
          id: r.id,
          appleMusicArtistId: r.apple_music_artist_id,
          createdAt: r.created_at,
          albumCount: albumCountByArtist.get(r.id) ?? 0,
          trackCount: trackCountByArtist.get(r.id) ?? 0,
          sampleAlbumTitle: sampleAlbumByArtist.get(r.id)?.title ?? null,
          sampleAlbumJacketUrl: sampleAlbumByArtist.get(r.id)?.jacketUrl ?? null,
        })),
    }))
    .sort((a, b) => b.candidates.length - a.candidates.length)

  return <DuplicateReviewClient groups={groups} />
}
