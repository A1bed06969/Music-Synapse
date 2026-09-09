//
// アーティスト詳細ページ(3カラム版)のRIGHTカラム、各セクションのナビゲーション
// バッジに出す件数。重い集計を避けるため、head:trueのcount専用クエリを使い、
// 各セクションが実際に描画する内容と1件単位で完全一致することは保証しない
// (目安値として設計。詳細はdocs/superpowers/specs/2026-09-09-artist-knowledge-interface-design.md
// の「RIGHTカラム: Navigation」参照)。
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchArtistMediaSelections } from './fetchArtistMediaSelections.ts'

export type ArtistSectionCounts = {
  discography: number
  timeline: number
  live: number
  network: number
  media: number
  ranking: number
  awards: number
  radio: number
}

export function sumTimelineCounts(counts: {
  releaseCount: number
  liveCount: number
  festivalCount: number
  tieUpCount: number
  mediaCount: number
  awardCount: number
}): number {
  return (
    counts.releaseCount +
    counts.liveCount +
    counts.festivalCount +
    counts.tieUpCount +
    counts.mediaCount +
    counts.awardCount
  )
}

async function countAlbums(supabase: SupabaseClient, artistId: string): Promise<number> {
  const { data: coArtistLinks } = await supabase.from('album_artist').select('album_id').eq('artist_id', artistId)
  const coArtistAlbumIds = (coArtistLinks ?? []).map((r) => r.album_id as string)

  let query = supabase.from('album').select('id', { count: 'exact', head: true }).is('primary_album_id', null)
  query =
    coArtistAlbumIds.length > 0
      ? query.or(`artist_id.eq.${artistId},id.in.(${coArtistAlbumIds.join(',')})`)
      : query.eq('artist_id', artistId)
  const { count } = await query
  return count ?? 0
}

async function countAppearances(supabase: SupabaseClient, artistId: string): Promise<number> {
  const { data: links } = await supabase
    .from('event_appearance_artist')
    .select('event_appearance_id')
    .eq('artist_id', artistId)
  const appearanceIds = [...new Set((links ?? []).map((r) => r.event_appearance_id as number))]
  return appearanceIds.length
}

/** `ranking_entry`/`award_entry`はどちらも`artist_id`/`album_id`/`track_id`を
 * 個別に持つ(どの粒度で選出されたかによりどれかがnullになる)。このアーティスト
 * 起点での「直接+アルバム/トラック経由」の行をすべて拾うためのPostgREST `.or()`
 * フィルター文字列を組み立てる。album_artist/track_artist(コラボ)経由の間接一致
 * は対象外とする(本番データで合計5行のみの稀なケースのため、v1ではスコープ外)。 */
export async function buildArtistRankingAwardFilter(supabase: SupabaseClient, artistId: string): Promise<string> {
  const [{ data: albumRows }, { data: trackRows }] = await Promise.all([
    supabase.from('album').select('id').eq('artist_id', artistId),
    supabase.from('track').select('id').eq('artist_id', artistId),
  ])
  const albumIds = (albumRows ?? []).map((r) => r.id as string)
  const trackIds = (trackRows ?? []).map((r) => r.id as string)

  const clauses = [`artist_id.eq.${artistId}`]
  if (albumIds.length > 0) clauses.push(`album_id.in.(${albumIds.join(',')})`)
  if (trackIds.length > 0) clauses.push(`track_id.in.(${trackIds.join(',')})`)
  return clauses.join(',')
}

export async function fetchArtistSectionCounts(
  supabase: SupabaseClient,
  artistId: string
): Promise<ArtistSectionCounts> {
  const rankingAwardFilter = await buildArtistRankingAwardFilter(supabase, artistId)

  const [
    discography,
    live,
    { count: musicEventCount },
    { count: tieUpCount },
    { count: awardCount },
    { count: networkA },
    { count: networkB },
    { count: rankingCount },
    mediaSelections,
  ] = await Promise.all([
    countAlbums(supabase, artistId),
    countAppearances(supabase, artistId),
    supabase.from('music_event').select('id', { count: 'exact', head: true }).eq('artist_id', artistId),
    supabase
      .from('sync_entry')
      .select('id, track:track_id!inner(artist_id)', { count: 'exact', head: true })
      .eq('track.artist_id', artistId),
    supabase.from('award_entry').select('id', { count: 'exact', head: true }).or(rankingAwardFilter),
    supabase.from('artist_relation').select('id', { count: 'exact', head: true }).eq('artist_id_a', artistId),
    supabase.from('artist_relation').select('id', { count: 'exact', head: true }).eq('artist_id_b', artistId),
    supabase.from('ranking_entry').select('id', { count: 'exact', head: true }).or(rankingAwardFilter),
    fetchArtistMediaSelections(supabase, artistId),
  ])

  return {
    discography,
    timeline: sumTimelineCounts({
      releaseCount: discography,
      liveCount: musicEventCount ?? 0,
      festivalCount: live,
      tieUpCount: tieUpCount ?? 0,
      mediaCount: mediaSelections.length,
      awardCount: awardCount ?? 0,
    }),
    live,
    network: (networkA ?? 0) + (networkB ?? 0),
    media: 0,
    ranking: rankingCount ?? 0,
    awards: awardCount ?? 0,
    radio: mediaSelections.length,
  }
}
