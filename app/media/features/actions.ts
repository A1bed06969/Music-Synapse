'use server'

import { createClient } from '@/utils/Supabase/server'

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export type RankingPreviewEntry = {
  id: number
  rank: number | null
  periodDate: string | null
  label: string
  href: string | null
  sub: string | null
  imageUrl: string | null
  isArtistOnly: boolean
  metricValue: number | null
  metricLabel: string | null
}

export type RankingPreview = {
  id: string
  name: string
  mediaName: string | null
  description: string | null
  imageUrl: string | null
  sourceUrl: string | null
  listType: string
  entries: RankingPreviewEntry[]
  totalCount: number
}

const PAGE_SIZE = 500

/** キュレーションコンテンツ1件(ranking)のプレビューを取得する。中央カラムで
 * 年度別に仕分けて全件表示するため、ranking_entryをページングしながら全件取得する。 */
export async function getRankingPreview(rankingId: string): Promise<RankingPreview | null> {
  const supabase = await createClient()

  const { data: ranking } = await supabase
    .from('ranking')
    .select('id, name, source, description, list_type, image_url, source_url, media:media_id(id, name)')
    .eq('id', rankingId)
    .maybeSingle()
  if (!ranking) return null

  const isSelection = ranking.list_type === 'selection'
  const media = firstOf(ranking.media)

  async function fetchPage(from: number) {
    return supabase
      .from('ranking_entry')
      .select(
        `id, rank, period_date, metric_value, metric_label,
         track:track_id(id, title, artist:artist_id(name), album:album_id(jacket_url)),
         album:album_id(id, title, jacket_url, artist:artist_id(name)),
         artist:artist_id(id, name, image_url)`,
        { count: 'exact' }
      )
      .eq('ranking_id', rankingId)
      .order(isSelection ? 'id' : 'rank', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
  }

  type EntryRow = NonNullable<Awaited<ReturnType<typeof fetchPage>>['data']>[number]
  const entries: EntryRow[] = []
  let totalCount = 0
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, count } = await fetchPage(from)
    if (count != null) totalCount = count
    if (!page || page.length === 0) break
    entries.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  const previewEntries: RankingPreviewEntry[] = entries.map((e) => {
    const track = firstOf(e.track)
    const album = firstOf(e.album)
    const artist = firstOf(e.artist)
    const trackArtist = track ? firstOf(track.artist) : null
    const albumArtist = album ? firstOf(album.artist) : null
    const trackAlbum = track ? firstOf(track.album) : null

    return {
      id: e.id,
      rank: e.rank,
      periodDate: e.period_date,
      label: track?.title ?? album?.title ?? artist?.name ?? '—',
      href: track ? `/tracks/${track.id}` : album ? `/albums/${album.id}` : artist ? `/artists/${artist.id}` : null,
      sub: track ? (trackArtist?.name ?? null) : album ? (albumArtist?.name ?? null) : null,
      imageUrl: album?.jacket_url ?? trackAlbum?.jacket_url ?? artist?.image_url ?? null,
      isArtistOnly: !track && !album && !!artist,
      metricValue: e.metric_value,
      metricLabel: e.metric_label,
    }
  })

  return {
    id: ranking.id,
    name: ranking.name,
    mediaName: media?.name ?? ranking.source ?? null,
    description: ranking.description,
    imageUrl: ranking.image_url,
    sourceUrl: ranking.source_url,
    listType: ranking.list_type,
    entries: previewEntries,
    totalCount: totalCount || previewEntries.length,
  }
}
