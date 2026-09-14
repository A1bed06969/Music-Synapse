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
import type { SupabaseClient } from '@supabase/supabase-js'

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

// album.idを参照するテーブル一覧(2026-09-14、information_schemaで確認済み)
const ALBUM_FK_REFERENCES: { table: string; column: string }[] = [
  { table: 'album', column: 'primary_album_id' },
  { table: 'album_artwork', column: 'album_id' },
  { table: 'album_credit', column: 'album_id' },
  { table: 'album_genre', column: 'album_id' },
  { table: 'album_match_log', column: 'stub_album_id' },
  { table: 'album_pickup', column: 'album_id' },
  { table: 'artist_credit', column: 'album_id' },
  { table: 'award_entry', column: 'album_id' },
  { table: 'collection_entry', column: 'album_id' },
  { table: 'contest_entry', column: 'album_id' },
  { table: 'disc_guide_selection', column: 'album_id' },
  { table: 'genre_highlight', column: 'album_id' },
  { table: 'radio_rotation', column: 'album_id' },
  { table: 'ranking_entry', column: 'album_id' },
  { table: 'track', column: 'album_id' },
]

// track.idを参照するテーブル一覧(2026-09-14、information_schemaで確認済み)
const TRACK_FK_REFERENCES: { table: string; column: string }[] = [
  { table: 'album', column: 'representative_track_id' },
  { table: 'artist_credit', column: 'track_id' },
  { table: 'award_entry', column: 'track_id' },
  { table: 'collection_entry', column: 'track_id' },
  { table: 'contest_entry', column: 'track_id' },
  { table: 'playlist_track', column: 'track_id' },
  { table: 'radio_rotation', column: 'track_id' },
  { table: 'ranking_entry', column: 'track_id' },
  { table: 'setlist_track', column: 'track_id' },
  { table: 'sync_entry', column: 'track_id' },
  { table: 'track_credit', column: 'track_id' },
  { table: 'track_genre', column: 'track_id' },
  { table: 'track_instrument', column: 'track_id' },
  // track_artist.track_idはここでは扱わない(重複trackが持つtrack_artist行は
  // 通常無い前提だが、念のためmergeTrackArtistRows内で個別に確認・移設する)
]

async function repointFk(
  supabase: AdminClient,
  refs: { table: string; column: string }[],
  fromId: string,
  toId: string,
  execute: boolean
): Promise<{ table: string; column: string; error: string | null; movedCount: number }[]> {
  const outcomes: { table: string; column: string; error: string | null; movedCount: number }[] = []
  for (const ref of refs) {
    if (!execute) {
      const { count, error } = await supabase.from(ref.table).select('*', { count: 'exact', head: true }).eq(ref.column, fromId)
      outcomes.push({ table: ref.table, column: ref.column, error: error ? error.message : null, movedCount: count ?? 0 })
      continue
    }
    const { error, count } = await supabase.from(ref.table).update({ [ref.column]: toId }, { count: 'exact' }).eq(ref.column, fromId)
    outcomes.push({ table: ref.table, column: ref.column, error: error ? error.message : null, movedCount: count ?? 0 })
  }
  return outcomes
}

const TRACK_MERGE_FIELDS = [
  'youtube_video_id', 'preview_url', 'apple_music_track_id', 'spotify_track_id',
  'youtube_music_track_id', 'amazon_music_track_id', 'lyric_url', 'track_review',
] as const

/** 本体trackが持たないフィールドを重複trackの値で埋める(既存の値は上書きしない) */
async function fillTrackFields(supabase: AdminClient, canonicalId: string, duplicateRow: RawTrackRow, execute: boolean) {
  const patch: Record<string, unknown> = {}
  const filled: string[] = []
  const { data: canonicalRow, error } = await supabase.from('track').select(TRACK_MERGE_FIELDS.join(',')).eq('id', canonicalId).single()
  if (error || !canonicalRow) throw new Error(`fillTrackFields: 本体track取得失敗(${canonicalId}): ${error?.message}`)

  const canonical = canonicalRow as unknown as Record<string, unknown>
  const dup = duplicateRow as unknown as Record<string, unknown>
  for (const field of TRACK_MERGE_FIELDS) {
    const canonicalValue = canonical[field]
    const dupValue = dup[field]
    if ((canonicalValue === null || canonicalValue === '') && dupValue !== null && dupValue !== '') {
      patch[field] = dupValue
      filled.push(field)
    }
  }
  if (filled.length > 0 && execute) {
    const { error: updateError } = await supabase.from('track').update(patch).eq('id', canonicalId)
    if (updateError) throw new Error(`fillTrackFields: 本体track更新失敗(${canonicalId}): ${updateError.message}`)
  }
  return { filled }
}

/** track_artist行を作成する(既存の(track_id, artist_id)組があれば重複挿入しない。
 * track_artistにはこの組み合わせのユニーク制約が無いため、アプリ側で確認する) */
async function upsertTrackArtist(
  supabase: AdminClient,
  trackId: string,
  artistId: string,
  role: 'primary' | 'featuring',
  billingOrder: number,
  execute: boolean
): Promise<void> {
  const { data: existing, error: selectError } = await supabase
    .from('track_artist')
    .select('id')
    .eq('track_id', trackId)
    .eq('artist_id', artistId)
    .maybeSingle()
  if (selectError) throw new Error(`upsertTrackArtist: 既存確認失敗(${trackId}, ${artistId}): ${selectError.message}`)
  if (existing) return // 既に存在するので何もしない
  if (!execute) return
  const { error: insertError } = await supabase
    .from('track_artist')
    .insert({ track_id: trackId, artist_id: artistId, role, billing_order: billingOrder })
  if (insertError) throw new Error(`upsertTrackArtist: 挿入失敗(${trackId}, ${artistId}): ${insertError.message}`)
}

/** album_artist行を作成する(album_artistは(album_id, artist_id)にユニーク制約が
 * あるため、DBの制約違反を避けるためにも事前確認する) */
async function upsertAlbumArtist(
  supabase: AdminClient,
  albumId: string,
  artistId: string,
  role: 'primary' | 'featuring',
  billingOrder: number,
  execute: boolean
): Promise<void> {
  const { data: existing, error: selectError } = await supabase
    .from('album_artist')
    .select('id')
    .eq('album_id', albumId)
    .eq('artist_id', artistId)
    .maybeSingle()
  if (selectError) throw new Error(`upsertAlbumArtist: 既存確認失敗(${albumId}, ${artistId}): ${selectError.message}`)
  if (existing) return
  if (!execute) return
  const { error: insertError } = await supabase
    .from('album_artist')
    .insert({ album_id: albumId, artist_id: artistId, role, billing_order: billingOrder })
  if (insertError) throw new Error(`upsertAlbumArtist: 挿入失敗(${albumId}, ${artistId}): ${insertError.message}`)
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

  let succeeded = 0
  let failed = 0
  let featParsedCount = 0
  let fallbackOrderCount = 0
  let trackArtistCreated = 0
  let albumArtistCreated = 0
  let tracksDeleted = 0
  let albumsDeleted = 0
  let fkRepointFailures = 0

  for (const group of groups) {
    try {
      const candidates: CanonicalCandidate[] = group.rows.map((r) => toCanonicalCandidate(rawById.get(r.id)!))
      const canonical = pickCanonicalTrack(candidates)
      const canonicalRawRow = rawById.get(canonical.id)!
      const runnerUp = candidates.length > 1 ? pickCanonicalTrack(candidates.filter((c) => c.id !== canonical.id)) : null
      const canonicalCount = Object.values(canonical.enrichment).filter((v) => v !== null && v !== '').length
      const runnerUpCount = runnerUp ? Object.values(runnerUp.enrichment).filter((v) => v !== null && v !== '').length : 0
      const reason =
        !runnerUp || canonicalCount !== runnerUpCount ? `補完フィールド数最大(${canonicalCount}件)` : 'id文字列比較で決定'

      const billingCandidates: BillingCandidate[] = group.rows.map((r) => {
        const c = candidates.find((c) => c.artistId === r.artistId)!
        const nonNullCount = Object.values(c.enrichment).filter((v) => v !== null && v !== '').length
        return { artistId: r.artistId, artistName: artistNames.get(r.artistId) ?? r.artistId, richnessScore: nonNullCount }
      })
      const billing = determineBillingOrder(group.rows[0].title, billingCandidates)

      const featuredNames = extractFeaturedNames(group.rows[0].title)
      const nonFeaturedCandidateCount = featuredNames
        ? billingCandidates.filter((c) => !featuredNames.includes(c.artistName.trim())).length
        : 0
      const usedFeatParsing = featuredNames !== null && nonFeaturedCandidateCount === 1
      if (usedFeatParsing) featParsedCount++
      else fallbackOrderCount++

      console.log(`=== ${group.rows[0].title} ===`)
      console.log(`  本体track: ${canonical.id}(artist_id=${canonical.artistId}) — 選定理由: ${reason}`)

      // 本体trackへ、グループ内の全アーティストのtrack_artistを作成する
      for (const b of billing) {
        await upsertTrackArtist(supabase, canonical.id, b.artistId, b.role, b.billingOrder, !DRY_RUN)
        trackArtistCreated++
      }
      console.log(
        `  track_artist(${usedFeatParsing ? 'タイトル解析' : 'フォールバック'}): ${billing.map((b) => `${artistNames.get(b.artistId) ?? b.artistId}(${b.role}, order=${b.billingOrder})`).join(' / ')}`
      )

      // 本体albumへ、同じ表示順でalbum_artistを作成する(本体trackのalbum_idを基準にする)
      const canonicalAlbumId = canonicalRawRow.album_id
      for (const b of billing) {
        await upsertAlbumArtist(supabase, canonicalAlbumId, b.artistId, b.role, b.billingOrder, !DRY_RUN)
        albumArtistCreated++
      }

      // 重複track(本体以外)を、フィールド補完→FK付け替え→削除する
      for (const dupRow of group.rows) {
        if (dupRow.id === canonical.id) continue
        const dupRawRow = rawById.get(dupRow.id)!
        const { filled } = await fillTrackFields(supabase, canonical.id, dupRawRow, !DRY_RUN)
        if (filled.length > 0) console.log(`    補完(${dupRow.id} → ${canonical.id}): [${filled.join(', ')}]`)

        const fkOutcomes = await repointFk(supabase, TRACK_FK_REFERENCES, dupRow.id, canonical.id, !DRY_RUN)
        const failedFks = fkOutcomes.filter((o) => o.error !== null)
        if (failedFks.length > 0) {
          console.log(`    ⚠️ track(${dupRow.id})のFK付け替え失敗: ${failedFks.map((f) => `${f.table}.${f.column}(${f.error})`).join(', ')}`)
          console.log(`    ⚠️ 重複track(${dupRow.id})は削除しません`)
          fkRepointFailures++
          continue
        }
        if (!DRY_RUN) {
          const { error: deleteError } = await supabase.from('track').delete().eq('id', dupRow.id)
          if (deleteError) {
            console.log(`    ❌ 重複track(${dupRow.id})の削除に失敗しました: ${deleteError.message}`)
            continue
          }
        }
        tracksDeleted++

        // このtrackが属していた重複album(本体albumと異なる場合)を、収録trackが
        // 他に残っていなければ削除する
        const dupAlbumId = dupRawRow.album_id
        if (dupAlbumId === canonicalAlbumId) continue
        const { count: remainingTracks, error: countError } = await supabase
          .from('track')
          .select('id', { count: 'exact', head: true })
          .eq('album_id', dupAlbumId)
        if (countError) {
          console.log(`    ⚠️ album(${dupAlbumId})の残りtrack件数確認に失敗: ${countError.message}`)
          continue
        }
        if ((remainingTracks ?? 0) > 0) continue // 他のtrackが残っているアルバムは削除しない

        const albumFkOutcomes = await repointFk(supabase, ALBUM_FK_REFERENCES, dupAlbumId, canonicalAlbumId, !DRY_RUN)
        const failedAlbumFks = albumFkOutcomes.filter((o) => o.error !== null)
        if (failedAlbumFks.length > 0) {
          console.log(`    ⚠️ album(${dupAlbumId})のFK付け替え失敗: ${failedAlbumFks.map((f) => `${f.table}.${f.column}(${f.error})`).join(', ')}`)
          console.log(`    ⚠️ 重複album(${dupAlbumId})は削除しません`)
          fkRepointFailures++
          continue
        }
        if (!DRY_RUN) {
          const { error: albumDeleteError } = await supabase.from('album').delete().eq('id', dupAlbumId)
          if (albumDeleteError) {
            console.log(`    ❌ 重複album(${dupAlbumId})の削除に失敗しました: ${albumDeleteError.message}`)
            continue
          }
        }
        albumsDeleted++
        console.log(`    削除: album(${dupAlbumId})`)
      }
      succeeded++
    } catch (err) {
      console.log(`  ❌ このグループの処理に失敗しました: ${(err as Error).message}`)
      failed++
    }
  }

  if (ambiguousKeys.length > 0) {
    console.log(`\n⚠️ あいまいでスキップしたグループキー(全${ambiguousKeys.length}件): ${ambiguousKeys.join(', ')}`)
  }

  console.log(`\n=== サマリー ===`)
  console.log(`成功: ${succeeded}グループ、失敗: ${failed}グループ`)
  console.log(`表示順の決定方法: タイトル解析${featParsedCount}件 / フォールバック${fallbackOrderCount}件`)
  console.log(`作成: track_artist ${trackArtistCreated}件、album_artist ${albumArtistCreated}件`)
  console.log(`削除: track ${tracksDeleted}件、album ${albumsDeleted}件`)
  console.log(`FK付け替え失敗: ${fkRepointFailures}件${fkRepointFailures > 0 ? '(該当行は削除されていません)' : ''}`)

  console.log(`\n${DRY_RUN ? '[dry-run] 書き込みは行っていません。' : ''}`)
}

main()
