import { createClient } from '@/utils/Supabase/server'
import TrackBrowseClient from './TrackBrowseClient'

// 以前はトラック全件(812,813行)を1000件ずつ813回逐次取得してからブラウザ側で
// 絞り込んでいたため、ページ生成に232秒かかっていた。表示がアーティスト単位の
// グループなので、アーティストでページングし、そのページ分の曲だけを引く。
const PAGE_SIZE = 20

// 1アーティストあたりの表示曲数上限。コンピレーション等で数千曲ぶら下がる
// アーティストがいると、上限なしではPostgRESTの1000行上限に達して後続
// アーティストの曲が丸ごと欠落する(実際に20組中7組しか表示されない状態が発生した)。
const TRACKS_PER_ARTIST = 30

type TrackArtistRow = {
  id: string
  name: string
  image_url: string | null
  matched_by_name: boolean
  total_count: number
  results_capped?: boolean
}

type ArtistTrackRow = {
  artist_id: string
  id: string
  title: string
  duration_seconds: number | null
  ranked: boolean
  on_air: boolean
}

export default async function TracksPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const params = await searchParams
  const query = (params.q ?? '').trim()
  const page = Math.max(0, Number(params.page ?? 0) || 0)

  const supabase = await createClient()

  const { data: artistData } = await supabase.rpc('browse_track_artists', {
    p_query: query || null,
    p_limit: PAGE_SIZE,
    p_offset: page * PAGE_SIZE,
  })
  const artistRows = (artistData ?? []) as TrackArtistRow[]
  const totalCount = artistRows[0]?.total_count ? Number(artistRows[0].total_count) : 0
  const artistIds = artistRows.map((a) => a.id)

  // 曲の取得・並び替え・1組あたりの上限はDB側(browse_artist_tracks)で行う。
  // アーティスト名でヒットした場合はその人の全曲、曲名だけでヒットした場合は
  // 一致した曲だけを出す(従来のブラウザ側フィルタと同じ挙動)。
  const hasNameMatch = artistRows.some((a) => a.matched_by_name)
  let tracks: ArtistTrackRow[] = []
  if (artistIds.length > 0) {
    const { data: trackData } = await supabase.rpc('browse_artist_tracks', {
      p_artist_ids: artistIds,
      p_query: query || null,
      p_only_matching: Boolean(query) && !hasNameMatch,
      p_per_artist: TRACKS_PER_ARTIST,
    })
    tracks = (trackData ?? []) as ArtistTrackRow[]
  }

  const tracksByArtist = new Map<string, ArtistTrackRow[]>()
  for (const track of tracks) {
    const list = tracksByArtist.get(track.artist_id) ?? []
    list.push(track)
    tracksByArtist.set(track.artist_id, list)
  }

  const groups = artistRows
    .map((artist) => ({
      id: artist.id,
      name: artist.name,
      image_url: artist.image_url,
      tracks: (tracksByArtist.get(artist.id) ?? []).map((t) => ({
        id: t.id,
        title: t.title,
        duration_seconds: t.duration_seconds,
        ranked: t.ranked,
        onAir: t.on_air,
      })),
    }))
    .filter((g) => g.tracks.length > 0)

  return (
    <TrackBrowseClient
      groups={groups}
      query={query}
      page={page}
      pageSize={PAGE_SIZE}
      totalCount={totalCount}
      resultsCapped={Boolean(artistRows[0]?.results_capped)}
      tracksPerArtist={TRACKS_PER_ARTIST}
    />
  )
}
