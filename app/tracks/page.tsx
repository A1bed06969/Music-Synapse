import { createClient } from '@/utils/Supabase/server'
import TrackBrowseClient from './TrackBrowseClient'

const PAGE_SIZE = 1000

type TrackRow = {
  id: string
  title: string
  track_no: number | null
  artist_id: string | null
  duration_seconds: number | null
}

async function fetchAllTracks(supabase: Awaited<ReturnType<typeof createClient>>): Promise<TrackRow[]> {
  const rows: TrackRow[] = []
  let offset = 0
  // PostgRESTは1回のクエリで最大1000件しか返さないため、トラック全件(4000件超)を
  // 取得するにはoffsetをずらしながらページ単位で取得する必要がある。
  while (true) {
    const { data } = await supabase
      .from('track')
      .select('id, title, track_no, artist_id, duration_seconds')
      .range(offset, offset + PAGE_SIZE - 1)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return rows
}

type ArtistRow = { id: string; name: string; name_kana: string | null; image_url: string | null }

async function fetchAllArtists(supabase: Awaited<ReturnType<typeof createClient>>): Promise<ArtistRow[]> {
  const rows: ArtistRow[] = []
  let offset = 0
  // アーティスト総数がPostgRESTの1回あたり上限(1000件)を超えたため、trackと同じく
  // ページングする(この上限のせいで最近登録されたアーティストの曲が一覧に出ない
  // 不具合が実際に発生した)
  while (true) {
    const { data } = await supabase
      .from('artist')
      .select('id, name, name_kana, image_url')
      .range(offset, offset + PAGE_SIZE - 1)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return rows
}

export default async function TracksPage() {
  const supabase = await createClient()

  const [artists, tracks, rankingResult, rotationResult] = await Promise.all([
    fetchAllArtists(supabase),
    fetchAllTracks(supabase),
    supabase.from('ranking_entry').select('track_id').not('track_id', 'is', null),
    supabase.from('radio_rotation').select('track_id').not('track_id', 'is', null),
  ])

  const rankedTrackIds = new Set((rankingResult.data ?? []).map((r) => r.track_id as string))
  const onAirTrackIds = new Set((rotationResult.data ?? []).map((r) => r.track_id as string))

  const tracksByArtist = new Map<string, TrackRow[]>()
  for (const track of tracks) {
    if (!track.artist_id) continue
    const list = tracksByArtist.get(track.artist_id) ?? []
    list.push(track)
    tracksByArtist.set(track.artist_id, list)
  }

  const sortedArtists = artists.sort((a, b) =>
    (a.name_kana ?? a.name).localeCompare(b.name_kana ?? b.name, 'ja')
  )

  const groups = sortedArtists
    .map((artist) => {
      const artistTracks = tracksByArtist.get(artist.id) ?? []
      const sorted = [...artistTracks].sort((a, b) => {
        const aFeatured = rankedTrackIds.has(a.id) || onAirTrackIds.has(a.id)
        const bFeatured = rankedTrackIds.has(b.id) || onAirTrackIds.has(b.id)
        if (aFeatured !== bFeatured) return aFeatured ? -1 : 1
        const aNo = a.track_no ?? Number.MAX_SAFE_INTEGER
        const bNo = b.track_no ?? Number.MAX_SAFE_INTEGER
        if (aNo !== bNo) return aNo - bNo
        return a.title.localeCompare(b.title, 'ja')
      })
      return {
        id: artist.id,
        name: artist.name,
        image_url: artist.image_url,
        tracks: sorted.map((t) => ({
          id: t.id,
          title: t.title,
          duration_seconds: t.duration_seconds,
          ranked: rankedTrackIds.has(t.id),
          onAir: onAirTrackIds.has(t.id),
        })),
      }
    })
    .filter((g) => g.tracks.length > 0)

  return <TrackBrowseClient groups={groups} />
}
