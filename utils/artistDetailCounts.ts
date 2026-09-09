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

type RankingAwardTable = 'ranking_entry' | 'award_entry'

/** `ranking_entry`/`award_entry`はどちらも`artist_id`/`album_id`/`track_id`を
 * 個別に持つ(どの粒度で選出されたかによりどれかがnullになる)。このアーティスト
 * 起点での「直接+アルバム/トラック経由」の行を3方向のクエリに分けて取得し、
 * JS側でid重複排除して1本のリストにまとめる。album_artist/track_artist(コラボ)
 * 経由の間接一致は対象外とする(本番データで合計5行のみの稀なケースのため、
 * v1ではスコープ外)。
 *
 * 以前はid.in(...)形式のPostgRESTフィルター文字列を組み立てて`.or()`に渡す方式
 * だったが、大規模カタログのアーティスト(アルバム+トラック合計800件超)では
 * フィルター文字列が数十〜数百KBに達し、GETクエリパラメータとして送信できず
 * HTTP 414(またはNode側のヘッダーサイズ超過)で失敗していた。supabase-jsは
 * このケースで例外を投げず`{ data: null, error }`を返すため、呼び出し側が
 * `data`だけを見ていると失敗が空リストとして握りつぶされていた。加えて
 * `album`/`track`のid一覧取得もPostgRESTのデフォルト1000件上限に達すると
 * サイレントに切り詰められていた。fetchArtistMediaSelections.tsのradio_rotation
 * と同じ「embedded resourceの`!inner`フィルターで3方向から直接行を取得する」
 * パターンに倣うことで、idリストそのものを作らずURL長のリスクを解消する。 */
async function fetchArtistUnionRows<T extends { id: string | number }>(
  supabase: SupabaseClient,
  table: RankingAwardTable,
  artistId: string,
  select: string
): Promise<T[]> {
  const [direct, viaAlbum, viaTrack] = await Promise.all([
    supabase.from(table).select(select).eq('artist_id', artistId),
    supabase.from(table).select(`${select}, album:album_id!inner(artist_id)`).eq('album.artist_id', artistId),
    supabase.from(table).select(`${select}, track:track_id!inner(artist_id)`).eq('track.artist_id', artistId),
  ])

  for (const [via, res] of [
    ['artist_id', direct],
    ['album_id', viaAlbum],
    ['track_id', viaTrack],
  ] as const) {
    if (res.error) {
      console.error(`fetchArtistUnionRows: ${table} query via ${via} failed for artist ${artistId}`, res.error)
    }
  }

  const byId = new Map<string | number, T>()
  for (const row of [...(direct.data ?? []), ...(viaAlbum.data ?? []), ...(viaTrack.data ?? [])]) {
    const typed = row as unknown as T
    byId.set(typed.id, typed)
  }
  return Array.from(byId.values())
}

function compareWithNullsAsLargest(a: unknown, b: unknown, ascending: boolean): number {
  const aNull = a === null || a === undefined
  const bNull = b === null || b === undefined
  if (aNull && bNull) return 0
  if (aNull) return ascending ? 1 : -1
  if (bNull) return ascending ? -1 : 1
  if (a === b) return 0
  const isLess = (a as string | number) < (b as string | number)
  return isLess ? (ascending ? -1 : 1) : ascending ? 1 : -1
}

/** `ranking_entry`/`award_entry`の行を、このアーティストに紐づく分だけ
 * (直接artist_id + アルバム経由 + トラック経由、重複排除済み)取得する。
 * 呼び出し側ごとに必要な列/並び順/件数上限が異なる(概要ページは2件プレビュー、
 * 一覧ページは全件など)ため、`select`文字列と`orderBy`/`limit`をパラメータ化し、
 * fetchArtistUnionRowsで3方向の行を集めてからJS側でソート・切り詰めを行う
 * (3クエリを個別のPostgRESTクエリとして発行するため、ソート/limitはDB側では
 * なくマージ後にJSで行う必要がある)。 */
export async function fetchArtistRankingAwardRows<T extends { id: string | number }>(
  supabase: SupabaseClient,
  table: RankingAwardTable,
  artistId: string,
  select: string,
  options: { orderBy?: { column: string; ascending?: boolean }; limit?: number } = {}
): Promise<T[]> {
  const rows = await fetchArtistUnionRows<T>(supabase, table, artistId, select)

  let sorted = rows
  if (options.orderBy) {
    const { column, ascending = true } = options.orderBy
    sorted = [...rows].sort((a, b) =>
      compareWithNullsAsLargest((a as Record<string, unknown>)[column], (b as Record<string, unknown>)[column], ascending)
    )
  }

  return options.limit != null ? sorted.slice(0, options.limit) : sorted
}

export async function fetchArtistSectionCounts(
  supabase: SupabaseClient,
  artistId: string
): Promise<ArtistSectionCounts> {
  const [
    discography,
    live,
    { count: musicEventCount },
    { count: tieUpCount },
    awardRows,
    { count: networkA },
    { count: networkB },
    rankingRows,
    mediaSelections,
  ] = await Promise.all([
    countAlbums(supabase, artistId),
    countAppearances(supabase, artistId),
    supabase.from('music_event').select('id', { count: 'exact', head: true }).eq('artist_id', artistId),
    supabase
      .from('sync_entry')
      .select('id, track:track_id!inner(artist_id)', { count: 'exact', head: true })
      .eq('track.artist_id', artistId),
    fetchArtistRankingAwardRows<{ id: string }>(supabase, 'award_entry', artistId, 'id'),
    supabase.from('artist_relation').select('id', { count: 'exact', head: true }).eq('artist_id_a', artistId),
    supabase.from('artist_relation').select('id', { count: 'exact', head: true }).eq('artist_id_b', artistId),
    fetchArtistRankingAwardRows<{ id: string }>(supabase, 'ranking_entry', artistId, 'id'),
    fetchArtistMediaSelections(supabase, artistId),
  ])
  const awardCount = awardRows.length
  const rankingCount = rankingRows.length

  return {
    discography,
    timeline: sumTimelineCounts({
      releaseCount: discography,
      liveCount: musicEventCount ?? 0,
      festivalCount: live,
      tieUpCount: tieUpCount ?? 0,
      mediaCount: mediaSelections.length,
      awardCount,
    }),
    live,
    network: (networkA ?? 0) + (networkB ?? 0),
    media: 0,
    ranking: rankingCount,
    awards: awardCount,
    radio: mediaSelections.length,
  }
}
