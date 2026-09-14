// scripts/unify-track-artist-credits.ts
//
// track.titleに"feat"を含み、apple_music_track_id(または title+album title+
// track_no+duration_secondsのフォールバック)が一致するにもかかわらず異なる
// artist_idに分散しているトラックを、track_artist/album_artist経由の統合に
// まとめる。docs/superpowers/specs/2026-09-14-track-artist-unification-design.md参照。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/unify-track-artist-credits.ts --dry-run   (既定、書き込みなし)
//   npx tsx --env-file=.env.local scripts/unify-track-artist-credits.ts --execute
import { createAdminClient } from '@/utils/Supabase/admin'
import { groupTrackCredits, type TrackCreditRow } from '@/utils/trackCreditMatching'
import { pickCanonicalTrack, type CanonicalCandidate } from '@/utils/trackCreditCanonical'
import { determineBillingOrder, extractFeaturedNames, type BillingCandidate } from '@/utils/featuringBillingOrder'

type AdminClient = ReturnType<typeof createAdminClient>

type RawTrackRow = {
  id: string
  artist_id: string
  apple_music_track_id: string | null
  title: string
  album_id: string
  track_no: number | null
  duration_seconds: number | null
  youtube_video_id: string | null
  preview_url: string | null
  spotify_track_id: string | null
  youtube_music_track_id: string | null
  amazon_music_track_id: string | null
  lyric_url: string | null
  track_review: string | null
}

const TRACK_COLUMNS =
  'id, artist_id, apple_music_track_id, title, album_id, track_no, duration_seconds, youtube_video_id, preview_url, spotify_track_id, youtube_music_track_id, amazon_music_track_id, lyric_url, track_review'

// trackのidは全件"MS_TRK_"+英数字8桁([0-9a-z]{8})の形式(本番DBで
// `id !~ '^MS_TRK_[0-9a-z]{8}$'`が0件であることを確認済み)。
//
// "feat"を含むtrackは6万件超あり、PostgRESTの1リクエストあたり行数上限
// (既定1000件)を超えるためページングが必須なのは事前の想定通りだが、
// 素直に「ilike('title','%feat%').order('id').range(...)」を投げると、
// PostgreSQLのプランナが (a) track_pkey(id)をorder用にインデックススキャンし
// title条件を行ごとにフィルタする、または (b) 一致する63,519行を全部集めてから
// 明示的にid順ソートする、のいずれかの実行計画を選んでしまう。実測(EXPLAIN
// ANALYZE)ではどちらも数秒〜十数秒かかり、service_role接続が実際には継承する
// statement_timeout(authenticatorロール設定の8秒)を超えて
// "canceling statement due to statement timeout"で失敗することを本番DBに
// 対して確認した(単純なrange()ページングでは動作しない — このため以下では
// idの8文字目([0-9a-z]の36値)でtrackテーブル全体を36分割し、分割ごとに
// range()ページングする。分割条件(id >= lo AND id < hi)はtrack_pkeyの
// 範囲スキャンとして使え、pgroonga全文検索インデックス(ilike用)との
// BitmapAndにより1分割あたり1秒未満で完走することを実測で確認済み)。
const ID_PREFIX = 'MS_TRK_'
const ID_BUCKET_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz'.split('')

async function fetchFeaturingTracksInIdRange(
  supabase: AdminClient,
  lo: string,
  hi: string | null
): Promise<RawTrackRow[]> {
  const rows: RawTrackRow[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    let query = supabase
      .from('track')
      .select(TRACK_COLUMNS)
      .ilike('title', '%feat%')
      .gte('id', lo)
    if (hi !== null) query = query.lt('id', hi)
    const { data, error } = await query.order('id', { ascending: true }).range(offset, offset + pageSize - 1)
    if (error) throw new Error(`fetchFeaturingTracksInIdRange[${lo},${hi}): ${error.message}`)
    const page = (data ?? []) as RawTrackRow[]
    rows.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }
  return rows
}

async function fetchFeaturingTracks(supabase: AdminClient): Promise<RawTrackRow[]> {
  const rows: RawTrackRow[] = []
  for (let i = 0; i < ID_BUCKET_CHARS.length; i++) {
    const lo = `${ID_PREFIX}${ID_BUCKET_CHARS[i]}`
    // 'z'の次(最後の分割)は上限なし('{'は'z'の次のASCII文字だが、
    // idの形式が将来変わった場合の取りこぼしを避けるため上限を設けない)
    const hi = i + 1 < ID_BUCKET_CHARS.length ? `${ID_PREFIX}${ID_BUCKET_CHARS[i + 1]}` : null
    const bucketRows = await fetchFeaturingTracksInIdRange(supabase, lo, hi)
    rows.push(...bucketRows)
  }

  // 独立した経路(pgroongaインデックスのみを使うcount、実測665ms)で総数を
  // 検算する。分割方式が万一取りこぼしを起こしていた場合に、あいまいな
  // グループ数として静かに出力されるのではなく、ここで確実に検知する。
  const { count, error: countError } = await supabase
    .from('track')
    .select('id', { count: 'exact', head: true })
    .ilike('title', '%feat%')
  if (countError) throw new Error(`fetchFeaturingTracks (count検算): ${countError.message}`)
  if (count !== null && count !== rows.length) {
    throw new Error(
      `fetchFeaturingTracks: 分割取得件数(${rows.length})と独立カウント(${count})が一致しません。id分割ロジックを見直してください。`
    )
  }

  return rows
}

// album.idは主キー(一意)のため、chunk(最大500件)あたり最大500行しか返らず
// PostgRESTの1000件上限には抵触しない。ここでのchunk化は行数上限対策ではなく
// .in()に渡すID列挙のURL長対策(別の懸念)。
async function fetchAlbumTitles(supabase: AdminClient, albumIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const uniqueIds = [...new Set(albumIds)]
  for (let i = 0; i < uniqueIds.length; i += 500) {
    const chunk = uniqueIds.slice(i, i + 500)
    const { data, error } = await supabase.from('album').select('id, title').in('id', chunk)
    if (error) throw new Error(`fetchAlbumTitles: ${error.message}`)
    for (const row of data ?? []) map.set(row.id, row.title)
  }
  return map
}

// artist.idも主キー(一意)のため、同様にchunkあたり最大500行しか返らない。
async function fetchArtistNames(supabase: AdminClient, artistIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const uniqueIds = [...new Set(artistIds)]
  for (let i = 0; i < uniqueIds.length; i += 500) {
    const chunk = uniqueIds.slice(i, i + 500)
    const { data, error } = await supabase.from('artist').select('id, name').in('id', chunk)
    if (error) throw new Error(`fetchArtistNames: ${error.message}`)
    for (const row of data ?? []) map.set(row.id, row.name)
  }
  return map
}

function toCreditRow(r: RawTrackRow, albumTitles: Map<string, string>): TrackCreditRow {
  return {
    id: r.id,
    artistId: r.artist_id,
    appleMusicTrackId: r.apple_music_track_id,
    title: r.title,
    albumId: r.album_id,
    albumTitle: albumTitles.get(r.album_id) ?? '',
    trackNo: r.track_no,
    durationSeconds: r.duration_seconds,
  }
}

function toCanonicalCandidate(r: RawTrackRow): CanonicalCandidate {
  return {
    id: r.id,
    artistId: r.artist_id,
    enrichment: {
      youtubeVideoId: r.youtube_video_id,
      previewUrl: r.preview_url,
      appleMusicTrackId: r.apple_music_track_id,
      spotifyTrackId: r.spotify_track_id,
      youtubeMusicTrackId: r.youtube_music_track_id,
      amazonMusicTrackId: r.amazon_music_track_id,
      lyricUrl: r.lyric_url,
      trackReview: r.track_review,
    },
  }
}

const DRY_RUN = !process.argv.includes('--execute')

async function main() {
  const supabase = createAdminClient()

  console.log('"feat"を含むトラックを取得中...')
  const rawRows = await fetchFeaturingTracks(supabase)
  console.log(`  ${rawRows.length}件取得しました`)

  const albumTitles = await fetchAlbumTitles(supabase, rawRows.map((r) => r.album_id))
  const artistNames = await fetchArtistNames(supabase, rawRows.map((r) => r.artist_id))
  const rawById = new Map(rawRows.map((r) => [r.id, r]))

  const creditRows = rawRows.map((r) => toCreditRow(r, albumTitles))
  const { groups, ambiguousKeys } = groupTrackCredits(creditRows)
  const totalRowsInvolved = groups.reduce((sum, g) => sum + g.rows.length, 0)
  const totalAlbumsInvolved = new Set(groups.flatMap((g) => g.rows.map((r) => r.albumId))).size

  console.log(
    `\n対象グループ: ${groups.length}件(関与track行: ${totalRowsInvolved}件、関与album行: ${totalAlbumsInvolved}件)、あいまいでスキップ: ${ambiguousKeys.length}件\n`
  )

  let featParsedCount = 0
  let fallbackOrderCount = 0

  for (const group of groups) {
    const candidates: CanonicalCandidate[] = group.rows.map((r) => toCanonicalCandidate(rawById.get(r.id)!))
    const canonical = pickCanonicalTrack(candidates)
    const runnerUp = candidates.length > 1 ? pickCanonicalTrack(candidates.filter((c) => c.id !== canonical.id)) : null
    const canonicalCount = Object.values(canonical.enrichment).filter((v) => v !== null && v !== '').length
    const runnerUpCount = runnerUp ? Object.values(runnerUp.enrichment).filter((v) => v !== null && v !== '').length : 0
    const reason =
      !runnerUp || canonicalCount !== runnerUpCount
        ? `補完フィールド数最大(${canonicalCount}件)`
        : 'id文字列比較で決定'

    const billingCandidates: BillingCandidate[] = group.rows.map((r) => ({
      artistId: r.artistId,
      artistName: artistNames.get(r.artistId) ?? r.artistId,
      richnessScore: candidates.find((c) => c.artistId === r.artistId) === canonical ? 1 : 0,
    }))
    const billing = determineBillingOrder(group.rows[0].title, billingCandidates)

    // 表示順がタイトル解析(feat.パターン)で決まったか、フォールバック
    // (richnessScore→id比較)で決まったかを、determineBillingOrderの内部条件と
    // 同じ判定式で再現して集計する(dry-runレポートの必須報告項目)
    const featuredNames = extractFeaturedNames(group.rows[0].title)
    const nonFeaturedCandidateCount = featuredNames
      ? billingCandidates.filter((c) => !featuredNames.includes(c.artistName.trim())).length
      : 0
    const usedFeatParsing = featuredNames !== null && nonFeaturedCandidateCount === 1
    if (usedFeatParsing) featParsedCount++
    else fallbackOrderCount++

    console.log(`=== ${group.rows[0].title} ===`)
    console.log(`  本体track: ${canonical.id}(artist_id=${canonical.artistId}) — 選定理由: ${reason}`)
    console.log(
      `  表示順(${usedFeatParsing ? 'タイトル解析' : 'フォールバック'}): ${billing.map((b) => `${artistNames.get(b.artistId) ?? b.artistId}(${b.role}, order=${b.billingOrder})`).join(' / ')}`
    )
  }

  console.log(`\n表示順の決定方法: タイトル解析${featParsedCount}件 / フォールバック${fallbackOrderCount}件`)

  if (ambiguousKeys.length > 0) {
    console.log(`\n⚠️ あいまいでスキップしたグループキー(全${ambiguousKeys.length}件): ${ambiguousKeys.join(', ')}`)
  }

  console.log(`\n${DRY_RUN ? '[dry-run] 書き込みは行っていません。' : ''}`)
}

main()
