// scripts/dedupe-artists.ts
//
// 重複アーティストレコード(スガ シカオ・坂本冬美・ワン・ダイレクションの
// カタログ丸ごと複製3組と、トラック0件の空スタブ49組)を1つのartist_idへ
// 統合する。docs/superpowers/specs/2026-09-12-artist-dedup-design.md参照。
//
// 対象グループは名前ではなくルールで抽出する(将来同種の重複が増えても
// 再利用できるように): 名前が重複していて、
//   (a) 全重複行のtrack数合計が0 → 「空スタブ」として副次データのみ統合
//   (b) track数合計>0かつ「ユニークな曲名数/track数合計」が0.2未満 → 「深刻」
//       としてアルバム・トラックも含めて統合
// それ以外(ユニーク率0.2以上、"Various Artists"等)は対象外。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/dedupe-artists.ts --dry-run   (既定、書き込みなし)
//   npx tsx --env-file=.env.local scripts/dedupe-artists.ts --execute
import { createAdminClient } from '@/utils/Supabase/admin'
import {
  pickCanonical,
  secondaryDataScore,
  compareCanonicalPriority,
  type ArtistCandidate,
} from '@/utils/artistDedupCanonical'
import { repointForeignKeys, type FkReference } from '@/utils/fkRepoint'
import { matchAlbums, matchTracks } from '@/utils/artistDedupMatching'

type AdminClient = ReturnType<typeof createAdminClient>

const UNIQUENESS_THRESHOLD = 0.2

type ArtistRow = { id: string; name: string; bio: string | null; image_url: string | null }
type TrackTitleRow = { artist_id: string; title: string }

// PostgRESTの1リクエストあたり行数上限(既定1000件)を超えるため、range()で
// ページングして全件取得する(このプロジェクトで繰り返し発生している既知の
// 不具合パターン。utils/fetchAllRows.ts参照)。
async function fetchAllArtists(supabase: AdminClient): Promise<ArtistRow[]> {
  const rows: ArtistRow[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('artist')
      .select('id, name, bio, image_url')
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`fetchAllArtists: ${error.message}`)
    const page = (data ?? []) as ArtistRow[]
    rows.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }
  return rows
}

// artist_idの重複候補が多い場合、track.idでの並び替えは(artist_idに絞り込んだ後の
// ソートにインデックスが使われず)本番DBでstatement timeoutを引き起こすことが実測で
// 判明した。artist_id, idの順で並べ替えるとartist_idのインデックスが使われ高速かつ
// 決定的にページングできる(タイトルの集計自体は順序に依存しないが、range()による
// ページングを正しく行うには安定した並び順が必要)。
async function fetchTrackTitlesForArtists(supabase: AdminClient, artistIds: string[]): Promise<TrackTitleRow[]> {
  const rows: TrackTitleRow[] = []
  for (let i = 0; i < artistIds.length; i += 200) {
    const chunk = artistIds.slice(i, i + 200)
    const pageSize = 1000
    let offset = 0
    while (true) {
      const { data, error } = await supabase
        .from('track')
        .select('artist_id, title')
        .in('artist_id', chunk)
        .order('artist_id', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1)
      if (error) throw new Error(`fetchTrackTitlesForArtists: ${error.message}`)
      const page = (data ?? []) as TrackTitleRow[]
      rows.push(...page)
      if (page.length < pageSize) break
      offset += pageSize
    }
  }
  return rows
}

type GroupKind = 'stub' | 'severe'
type DedupGroup = { name: string; artistIds: string[]; kind: GroupKind }

/** 名前が重複しているアーティストを、空スタブ/深刻の2種類に分類して返す
 * (ユニーク率0.2以上の中間的な重複は対象外なので含めない)。 */
function classifyGroups(allArtists: ArtistRow[], trackTitles: TrackTitleRow[]): DedupGroup[] {
  const idsByName = new Map<string, string[]>()
  for (const a of allArtists) {
    const list = idsByName.get(a.name) ?? []
    list.push(a.id)
    idsByName.set(a.name, list)
  }

  const titlesByArtistId = new Map<string, string[]>()
  for (const t of trackTitles) {
    const list = titlesByArtistId.get(t.artist_id) ?? []
    list.push(t.title)
    titlesByArtistId.set(t.artist_id, list)
  }

  const groups: DedupGroup[] = []
  for (const [name, artistIds] of idsByName) {
    if (artistIds.length < 2) continue

    const allTitles: string[] = []
    for (const id of artistIds) {
      const titles = titlesByArtistId.get(id)
      if (titles) allTitles.push(...titles)
    }

    if (allTitles.length === 0) {
      groups.push({ name, artistIds, kind: 'stub' })
      continue
    }

    const uniqueRatio = new Set(allTitles).size / allTitles.length
    if (uniqueRatio < UNIQUENESS_THRESHOLD) {
      groups.push({ name, artistIds, kind: 'severe' })
    }
    // それ以外(ユニーク率0.2以上)は対象外
  }
  return groups
}

type SecondaryCounts = {
  trackCount: number
  albumCount: number
  externalLinkCount: number
  genreCount: number
  relationCount: number
  mvBackfillLogCount: number
}

// countクエリが失敗すると`count`はnull/undefinedになり、`?? 0`がそれを本物の0件と
// 区別なく通してしまう(fetchTrackTitlesForArtistsで実際に踏んだのと同じ失敗パターン)。
// ここで拾い損ねるとpickCanonicalに偽の0件データが渡り、本体候補の誤選定に直結する
// ため、7クエリ全てエラーを確認してから読む。
async function fetchSecondaryCounts(supabase: AdminClient, artistId: string): Promise<SecondaryCounts> {
  const [track, album, link, genre, relA, relB, mv] = await Promise.all([
    supabase.from('track').select('id', { count: 'exact', head: true }).eq('artist_id', artistId),
    supabase.from('album').select('id', { count: 'exact', head: true }).eq('artist_id', artistId),
    supabase.from('artist_external_link').select('id', { count: 'exact', head: true }).eq('artist_id', artistId),
    supabase.from('artist_genre').select('artist_id', { count: 'exact', head: true }).eq('artist_id', artistId),
    supabase.from('artist_relation').select('id', { count: 'exact', head: true }).eq('artist_id_a', artistId),
    supabase.from('artist_relation').select('id', { count: 'exact', head: true }).eq('artist_id_b', artistId),
    supabase.from('youtube_mv_backfill_log').select('id', { count: 'exact', head: true }).eq('artist_id', artistId),
  ])
  const labeledResults: Array<[string, { error: { message: string } | null }]> = [
    ['track', track],
    ['album', album],
    ['artist_external_link', link],
    ['artist_genre', genre],
    ['artist_relation(a)', relA],
    ['artist_relation(b)', relB],
    ['youtube_mv_backfill_log', mv],
  ]
  for (const [label, result] of labeledResults) {
    if (result.error) {
      throw new Error(`fetchSecondaryCounts(${artistId}) ${label}: ${result.error.message}`)
    }
  }
  return {
    trackCount: track.count ?? 0,
    albumCount: album.count ?? 0,
    externalLinkCount: link.count ?? 0,
    genreCount: genre.count ?? 0,
    relationCount: (relA.count ?? 0) + (relB.count ?? 0),
    mvBackfillLogCount: mv.count ?? 0,
  }
}

async function buildCandidates(supabase: AdminClient, artistRows: ArtistRow[]): Promise<ArtistCandidate[]> {
  const candidates: ArtistCandidate[] = []
  for (const row of artistRows) {
    const counts = await fetchSecondaryCounts(supabase, row.id)
    candidates.push({
      id: row.id,
      trackCount: counts.trackCount,
      albumCount: counts.albumCount,
      externalLinkCount: counts.externalLinkCount,
      genreCount: counts.genreCount,
      relationCount: counts.relationCount,
      mvBackfillLogCount: counts.mvBackfillLogCount,
      hasBio: row.bio !== null && row.bio.trim() !== '',
      hasImage: row.image_url !== null,
    })
  }
  return candidates
}

/** 本体候補がどの判定基準(track数/album数/副次データスコア/id比較)で
 * 決まったかを人間が読める形で説明する(スペック「安全確認」で必須の
 * 選定理由の報告)。pickCanonicalと同じ優先順位を、残りの候補の中の
 * 次点(runner-up)と比較することで判定する。 */
function explainCanonicalReason(canonical: ArtistCandidate, all: ArtistCandidate[]): string {
  const others = all.filter((c) => c.id !== canonical.id)
  if (others.length === 0) return '重複なし'
  const runnerUp = pickCanonical(others)
  if (canonical.trackCount !== runnerUp.trackCount) {
    return `track数最大(${canonical.trackCount} vs 次点${runnerUp.trackCount})`
  }
  if (canonical.albumCount !== runnerUp.albumCount) {
    return `track数同数のためalbum数で決定(${canonical.albumCount} vs 次点${runnerUp.albumCount})`
  }
  const canonicalScore = secondaryDataScore(canonical)
  const runnerUpScore = secondaryDataScore(runnerUp)
  if (canonicalScore !== runnerUpScore) {
    return `track・album数同数のため副次データスコアで決定(${canonicalScore} vs 次点${runnerUpScore})`
  }
  return 'track・album数・副次データスコア全て同数のためid文字列比較で決定'
}

// artist.idを参照するテーブル一覧(2026-09-12、information_schemaで確認済み。
// track.artist_idは深刻3組のマッチング処理(mergeAlbumsAndTracks)で個別に
// 扱うためここには含めない)。album.artist_idは一覧には残すが、深刻3組
// (group.kind === 'severe')に限りmain()側でこのリストから除外して使う。
// 理由: このリストに含めたまま無条件にrepointForeignKeysへ渡すと、
// mergeAlbumsAndTracksが呼ばれるより前にここで重複の全アルバムのartist_idが
// 本体へ付け替わってしまい、mergeAlbumsAndTracks側の
// `.eq('artist_id', duplicateArtistId)`が0件しかヒットしなくなる
// (タイトル一致でのアルバム統合・トラック統合が実行時に一切走らず、
// 重複アルバム・トラックがタイトル重複したまま本体の直下に付け替わるだけに
// なってしまう)。空スタブ49組はmergeAlbumsAndTracksを呼ばないため、
// そちらは従来どおりこのリストのalbum.artist_idで付け替える。
const ARTIST_FK_REFERENCES: FkReference[] = [
  { table: 'album', column: 'artist_id' },
  { table: 'album_artist', column: 'artist_id' },
  { table: 'artist_credit', column: 'artist_id' },
  { table: 'artist_label', column: 'artist_id' },
  { table: 'artist_match_log', column: 'stub_artist_id' },
  { table: 'award_entry', column: 'artist_id' },
  { table: 'bio_generation_log', column: 'artist_id' },
  { table: 'contest_entry', column: 'artist_id' },
  { table: 'event_appearance', column: 'artist_id' },
  { table: 'event_appearance_artist', column: 'artist_id' },
  { table: 'festival_pilot_artist_link', column: 'artist_id' },
  { table: 'genre_highlight', column: 'artist_id' },
  { table: 'music_event', column: 'artist_id' },
  { table: 'person_artist_relation', column: 'artist_id' },
  { table: 'radio_rotation', column: 'artist_id' },
  { table: 'ranking_entry', column: 'artist_id' },
  { table: 'setlist', column: 'artist_id' },
  { table: 'track_artist', column: 'artist_id' },
  { table: 'youtube_mv_backfill_log', column: 'artist_id' },
]

// album.idを参照するテーブル一覧(2026-09-12確認済み。マッチ済みアルバムを
// 削除する前に使う。track.album_idはトラック統合が終わっていれば通常0件)
const ALBUM_FK_REFERENCES: FkReference[] = [
  { table: 'album', column: 'primary_album_id' },
  { table: 'album_artist', column: 'album_id' },
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

// track.idを参照するテーブル一覧(2026-09-12確認済み。マッチ済みトラックを
// 削除する前に使う)
const TRACK_FK_REFERENCES: FkReference[] = [
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
  { table: 'track_artist', column: 'track_id' },
  { table: 'track_credit', column: 'track_id' },
  { table: 'track_genre', column: 'track_id' },
  { table: 'track_instrument', column: 'track_id' },
]

type AlbumFullRow = { id: string; title: string }
type TrackFullRow = { id: string; title: string; disc_number: number | null; track_no: number | null }

const TRACK_MERGE_FIELDS = [
  'youtube_video_id', 'preview_url', 'apple_music_track_id', 'spotify_track_id',
  'youtube_music_track_id', 'amazon_music_track_id', 'lyric_url', 'track_review', 'duration_seconds',
]

/** 対応付けられたトラックペアについて、本体側がnullの項目だけ重複側の値を
 * コピーする(スペック「6. マッチしたトラックのフィールド補完」)。その後、
 * トラックを参照する外部キーを本体トラックへ付け替えてから重複トラックを
 * 削除する(execute時のみ)。 途中の書き込みが失敗した場合、後続の削除まで
 * 進めるとデータを黙って失ってしまう(補完前の重複トラックを消してしまう)
 * ため、本体側の更新に失敗したらそのトラックペアの処理を打ち切り、重複
 * トラックは削除しない(スペック「データを黙って失わない」の要請)。 */
async function mergeMatchedTrack(supabase: AdminClient, canonicalTrackId: string, duplicateTrackId: string, execute: boolean) {
  const [{ data: canonicalTrack }, { data: duplicateTrack }] = await Promise.all([
    supabase.from('track').select(TRACK_MERGE_FIELDS.join(',')).eq('id', canonicalTrackId).single(),
    supabase.from('track').select(TRACK_MERGE_FIELDS.join(',')).eq('id', duplicateTrackId).single(),
  ])
  const patch: Record<string, unknown> = {}
  const filled: string[] = []
  if (canonicalTrack && duplicateTrack) {
    // .select(TRACK_MERGE_FIELDS.join(','))は動的な文字列のためSupabaseの型生成が
    // 列を解決できず`GenericStringError`型になる(fillScalarFieldsForGroupと同じ
    // 既知のパターン)。実行時の値は問題ないのでunknown経由でキャストする
    // (直接`as Record<string, unknown>`だとtscでTS2352になり型検査が通らない)。
    const canonicalRecord = canonicalTrack as unknown as Record<string, unknown>
    const duplicateRecord = duplicateTrack as unknown as Record<string, unknown>
    for (const field of TRACK_MERGE_FIELDS) {
      const canonicalValue = canonicalRecord[field]
      const duplicateValue = duplicateRecord[field]
      if ((canonicalValue === null || canonicalValue === '') && duplicateValue !== null && duplicateValue !== '') {
        patch[field] = duplicateValue
        filled.push(field)
      }
    }
  }
  if (execute) {
    if (Object.keys(patch).length > 0) {
      const { error: updateError } = await supabase.from('track').update(patch).eq('id', canonicalTrackId)
      if (updateError) {
        console.warn(`    ⚠️ track(id=${canonicalTrackId})のフィールド補完に失敗しました: ${updateError.message}`)
        console.warn(`    ⚠️ 重複track(id=${duplicateTrackId})は削除しません(補完に失敗したため)`)
        return { filled: [] }
      }
    }
    const trackFkOutcomes = await repointForeignKeys(TRACK_FK_REFERENCES, duplicateTrackId, canonicalTrackId, (table, column, fromId, toId) =>
      updateFk(supabase, table, column, fromId, toId, execute)
    )
    const failedTrackFks = trackFkOutcomes.filter((o) => o.status === 'failed')
    if (failedTrackFks.length > 0) {
      console.warn(
        `    ⚠️ track(id=${duplicateTrackId})のFK付け替え失敗: ${failedTrackFks.map((f) => `${f.table}.${f.column}(${f.error})`).join(', ')}`
      )
      console.warn(`    ⚠️ 重複track(id=${duplicateTrackId})は削除しません(付け替えに失敗した参照が残っているため)`)
      return { filled }
    }
    const { error: deleteError } = await supabase.from('track').delete().eq('id', duplicateTrackId)
    if (deleteError) {
      console.warn(`    ⚠️ 重複track(id=${duplicateTrackId})の削除に失敗しました: ${deleteError.message}`)
    }
  }
  return { filled }
}

/** 1件の重複artist_idについて、アルバム・トラックをタイトル完全一致で本体へ
 * 対応付けて統合する(深刻3組専用。スペック「4〜8」参照)。 */
async function mergeAlbumsAndTracks(supabase: AdminClient, canonicalArtistId: string, duplicateArtistId: string, execute: boolean) {
  const [{ data: canonicalAlbums }, { data: duplicateAlbums }] = await Promise.all([
    supabase.from('album').select('id, title').eq('artist_id', canonicalArtistId),
    supabase.from('album').select('id, title').eq('artist_id', duplicateArtistId),
  ])
  const albumResult = matchAlbums((canonicalAlbums ?? []) as AlbumFullRow[], (duplicateAlbums ?? []) as AlbumFullRow[])

  let tracksMatched = 0
  let tracksFieldFilled = 0
  let tracksReassigned = 0
  const trackAmbiguousTitles: string[] = []
  const reassignedTrackTitles: string[] = []
  const matchedDuplicateAlbumIds = new Set(albumResult.matched.map((m) => m.duplicateId))

  for (const pair of albumResult.matched) {
    const [{ data: canonicalTracks }, { data: duplicateTracks }] = await Promise.all([
      supabase.from('track').select('id, title, disc_number, track_no').eq('album_id', pair.canonicalId),
      supabase.from('track').select('id, title, disc_number, track_no').eq('album_id', pair.duplicateId),
    ])
    const trackResult = matchTracks(
      (canonicalTracks ?? []) as TrackFullRow[],
      (duplicateTracks ?? []) as TrackFullRow[]
    )
    trackAmbiguousTitles.push(...trackResult.ambiguousTitles)

    for (const trackPair of trackResult.matched) {
      tracksMatched++
      const mergeResult = await mergeMatchedTrack(supabase, trackPair.canonicalId, trackPair.duplicateId, execute)
      if (mergeResult.filled.length > 0) tracksFieldFilled++
    }

    const matchedDuplicateTrackIds = new Set(trackResult.matched.map((m) => m.duplicateId))
    const unmatchedTracks = (duplicateTracks ?? []).filter((t) => !matchedDuplicateTrackIds.has(t.id))
    for (const t of unmatchedTracks) {
      tracksReassigned++
      reassignedTrackTitles.push(t.title)
      if (execute) {
        const { error } = await supabase.from('track').update({ artist_id: canonicalArtistId }).eq('id', t.id)
        if (error) console.warn(`    ⚠️ track(id=${t.id})の再割り当てに失敗しました: ${error.message}`)
      }
    }

    if (execute && unmatchedTracks.length === 0) {
      // アルバムの中身が全てマッチ・削除されたので、アルバム自体を削除する。
      // FK付け替えに失敗した参照が残っている場合は削除しない(main()の
      // artist行削除と同じ「失敗したら消さない」方針)。
      const albumFkOutcomes = await repointForeignKeys(ALBUM_FK_REFERENCES, pair.duplicateId, pair.canonicalId, (table, column, fromId, toId) =>
        updateFk(supabase, table, column, fromId, toId, execute)
      )
      const failedAlbumFks = albumFkOutcomes.filter((o) => o.status === 'failed')
      if (failedAlbumFks.length > 0) {
        console.warn(
          `    ⚠️ album(id=${pair.duplicateId})のFK付け替え失敗: ${failedAlbumFks.map((f) => `${f.table}.${f.column}(${f.error})`).join(', ')}`
        )
        console.warn(`    ⚠️ 重複album(id=${pair.duplicateId})は削除しません(付け替えに失敗した参照が残っているため)`)
      } else {
        const { error } = await supabase.from('album').delete().eq('id', pair.duplicateId)
        if (error) console.warn(`    ⚠️ 重複album(id=${pair.duplicateId})の削除に失敗しました: ${error.message}`)
      }
    } else if (execute && unmatchedTracks.length > 0) {
      // 未マッチのトラックが残っているアルバムは削除せず本体へ付け替える
      const { error } = await supabase.from('album').update({ artist_id: canonicalArtistId }).eq('id', pair.duplicateId)
      if (error) console.warn(`    ⚠️ album(id=${pair.duplicateId})の再割り当てに失敗しました: ${error.message}`)
    }
  }

  const unmatchedAlbums = (duplicateAlbums ?? []).filter((a) => !matchedDuplicateAlbumIds.has(a.id))
  for (const album of unmatchedAlbums) {
    if (execute) {
      const { error } = await supabase.from('album').update({ artist_id: canonicalArtistId }).eq('id', album.id)
      if (error) console.warn(`    ⚠️ album(id=${album.id})の再割り当てに失敗しました: ${error.message}`)
    }
  }

  // ここまでの処理で、マッチしたアルバム内のトラックはマッチ済み(→削除)か
  // 未マッチ(→本体へ再割り当て済み)のいずれかとして扱われている。しかし
  // あいまい/未対応のアルバム(unmatchedAlbumsで本体へ付け替えたアルバム自体の
  // トラック)は上のどのループにも含まれておらず、track.artist_idを個別に
  // 触っていない。track.artist_idはARTIST_FK_REFERENCESから意図的に除外されて
  // おり(このスペック参照)、この関数が唯一の付け替え責任を持つ。もしここで
  // 拾わなければ、重複artist行を削除する際にtrack.artist_idのFK制約
  // (ON DELETE CASCADE、2026-09-12にDBで確認済み)によってこれらのトラックが
  // 黙って一緒に削除されてしまう(スペックの「未対応データは削除せず本体へ
  // 再割り当てする」という核心の保証に反する)。そこで、重複artist_idを
  // まだ持っている残り全トラック(あいまいなアルバムに属するもの・
  // album_idを持たない孤立トラックのいずれも含む)を最後にまとめて
  // 本体へ再割り当てする。updateFkは1テーブル・1カラムの汎用付け替え関数
  // だが、単発利用にも使えるためここでも流用する(dry-runでは書き込まず
  // 件数だけ数える)。
  //
  // 注意(dry-runでの見え方): dry-runでは上のどの再割り当て/削除も実際には
  // 書き込まれないため、この時点でupdateFkが数える「artist_id=重複」の件数は
  // 実行前の状態(=そのduplicateの全track数)をそのまま反映する。つまり
  // dry-runレポート上のこの件数は、上で報告済みのtracksMatched/tracksReassigned
  // と重複してカウントされる(--execute時は先行する削除/再割り当てが実際に
  // 永続化されているため、ここで拾われるのはあいまい/未対応アルバム配下の
  // トラックのみになり、重複は生じない)。dry-runでの数値の意味は
  // 「現時点でこの重複artist_idを指しているtrack数」であり、
  // 「catch-allが正味で救うtrack数」ではない点に注意。
  const catchAllResult = await updateFk(supabase, 'track', 'artist_id', duplicateArtistId, canonicalArtistId, execute)
  if (catchAllResult.error) {
    console.warn(`    ⚠️ track(artist_id=${duplicateArtistId})の再割り当てに失敗しました: ${catchAllResult.error}`)
  }
  const tracksReassignedViaCatchAll = catchAllResult.count ?? 0
  // このcatch-all自体が失敗した場合、console.warnで報告するだけでは不十分:
  // track.artist_idはON DELETE CASCADEのため(album.artist_idのON DELETE
  // RESTRICTと違い)、呼び出し元がこの失敗を無視してartist行を削除すると
  // 再割り当てし損ねたトラックがCASCADEで一緒に消えてしまう。呼び出し元
  // (main())のartist削除ゲート(failedFks)にこの失敗を確実に伝えるため、
  // 戻り値にcatchAllFailedを含める。
  const catchAllFailed = catchAllResult.error !== null

  return {
    matchedAlbums: albumResult.matched.length,
    ambiguousAlbumTitles: albumResult.ambiguousTitles,
    reassignedAlbums: unmatchedAlbums.map((a) => a.title),
    tracksMatched,
    tracksFieldFilled,
    tracksReassigned,
    reassignedTrackTitles,
    trackAmbiguousTitles,
    tracksReassignedViaCatchAll,
    catchAllFailed,
  }
}

async function updateFk(
  supabase: AdminClient,
  table: string,
  column: string,
  fromId: string,
  toId: string,
  execute: boolean
): Promise<{ error: string | null; count?: number }> {
  if (!execute) {
    // dry-run: 実際には書き込まず、対象になる件数だけ数えて返す
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true }).eq(column, fromId)
    return { error: error ? error.message : null, count: count ?? 0 }
  }
  // { count: 'exact' }を付けると、UPDATEが実際に何件のマッチ行を更新したかが
  // 返ってくる(dry-runレポートで移設件数を報告するために必要)
  const { error, count } = await supabase.from(table).update({ [column]: toId }, { count: 'exact' }).eq(column, fromId)
  return { error: error ? error.message : null, count: count ?? 0 }
}

// 以下の3関数(fillScalarFieldsForGroup・migrateDedupedLinksForGroup・
// migrateRelationsForGroup)はいずれも「1件の重複」ではなく「グループ全体
// (本体+同グループの重複全員)」をまとめて1回のクエリで処理する
// (group-scoped)。pair-scoped(重複1件ごとにDBへ読みに行く)実装は
// --executeでは正しく動く(書き込みが重複間で永続化されるため)が、
// dry-runでは何も書き込まれないため後続の重複の読み取りが常に元の状態を
// 見てしまい、「重複行同士の関係」や「重複行同士で共通する外部リンク」が
// 絡むケースでレポートが不正確になる(deep-review発覚のバグ:
// スカラー項目補完の優先順位崩れ・関係性/リンクの重複間コリジョン誤検出)。
// FK付け替え(updateFk/repointForeignKeys)にはこの「重複間コリジョン」の
// 概念がそもそも無いため、そちらは従来どおりmain()内でduplicateごとに
// pair-scopedのまま呼び出す。

/** artist_external_link・artist_genreをグループ全体でまとめて本体へ移設する。
 * 本体の実データから始め、重複を優先順位順に処理しながら「今のところ本体が
 * 持っているキー」の集合を育てていく。これにより、dry-runでも「同じグループ内の
 * 別の重複が先に持ち込んだキー」との衝突を正しく重複削除として検出できる
 * (本体の実データだけを見ていた旧pair-scoped実装では、重複A・重複Bが互いに
 * 同じ(link_type,url)/genre_idを持つ場合、両方とも「moved」と誤って報告され、
 * 実際の--execute実行時とdry-runレポートの内容が食い違っていた)。
 * 本体側とのキー重複は移設せず削除する(スペック「3. 副次データの移設」)。 */
async function migrateDedupedLinksForGroup(
  supabase: AdminClient,
  canonicalId: string,
  duplicateIdsInPriorityOrder: string[],
  execute: boolean
): Promise<Map<string, { linksMoved: number; linksDropped: number; genresMoved: number; genresDropped: number }>> {
  const allIds = [canonicalId, ...duplicateIdsInPriorityOrder]
  const [{ data: allLinks, error: linksError }, { data: allGenres, error: genresError }] = await Promise.all([
    supabase.from('artist_external_link').select('id, artist_id, link_type, url').in('artist_id', allIds),
    supabase.from('artist_genre').select('artist_id, genre_id').in('artist_id', allIds),
  ])
  // fetchSecondaryCounts/fetchTrackTitlesForArtistsで踏んだのと同じ失敗パターン
  // (エラーを無視すると`data`がnullになり`?? []`が本物の0件と区別なく通して
  // しまう)を避けるため、読み取り後に必ずエラーを確認してから使う。
  if (linksError) throw new Error(`migrateDedupedLinksForGroup(canonical=${canonicalId}) artist_external_link: ${linksError.message}`)
  if (genresError) throw new Error(`migrateDedupedLinksForGroup(canonical=${canonicalId}) artist_genre: ${genresError.message}`)

  const resultByDup = new Map<string, { linksMoved: number; linksDropped: number; genresMoved: number; genresDropped: number }>()
  for (const dupId of duplicateIdsInPriorityOrder) resultByDup.set(dupId, { linksMoved: 0, linksDropped: 0, genresMoved: 0, genresDropped: 0 })

  const canonicalKeys = new Set((allLinks ?? []).filter((l) => l.artist_id === canonicalId).map((l) => `${l.link_type}|${l.url}`))
  for (const dupId of duplicateIdsInPriorityOrder) {
    const result = resultByDup.get(dupId)!
    for (const link of (allLinks ?? []).filter((l) => l.artist_id === dupId)) {
      const key = `${link.link_type}|${link.url}`
      if (canonicalKeys.has(key)) {
        result.linksDropped++
        if (execute) {
          const { error } = await supabase.from('artist_external_link').delete().eq('id', link.id)
          if (error) console.warn(`    ⚠️ artist_external_link(id=${link.id})の削除に失敗しました: ${error.message}`)
        }
      } else {
        result.linksMoved++
        canonicalKeys.add(key)
        if (execute) {
          const { error } = await supabase.from('artist_external_link').update({ artist_id: canonicalId }).eq('id', link.id)
          if (error) console.warn(`    ⚠️ artist_external_link(id=${link.id})の付け替えに失敗しました: ${error.message}`)
        }
      }
    }
  }

  const canonicalGenreIds = new Set((allGenres ?? []).filter((g) => g.artist_id === canonicalId).map((g) => g.genre_id))
  for (const dupId of duplicateIdsInPriorityOrder) {
    const result = resultByDup.get(dupId)!
    for (const g of (allGenres ?? []).filter((g) => g.artist_id === dupId)) {
      if (canonicalGenreIds.has(g.genre_id)) {
        result.genresDropped++
        if (execute) {
          const { error } = await supabase.from('artist_genre').delete().eq('artist_id', dupId).eq('genre_id', g.genre_id)
          if (error) console.warn(`    ⚠️ artist_genre(artist_id=${dupId}, genre_id=${g.genre_id})の削除に失敗しました: ${error.message}`)
        }
      } else {
        result.genresMoved++
        canonicalGenreIds.add(g.genre_id)
        if (execute) {
          const { error } = await supabase
            .from('artist_genre')
            .update({ artist_id: canonicalId })
            .eq('artist_id', dupId)
            .eq('genre_id', g.genre_id)
          if (error) console.warn(`    ⚠️ artist_genre(artist_id=${dupId}, genre_id=${g.genre_id})の付け替えに失敗しました: ${error.message}`)
        }
      }
    }
  }

  return resultByDup
}

/** artist_relationをグループ全体でまとめて本体へ移設する。本体または同グループ内の
 * いずれかの重複を指している行を1回のクエリで全件取得し、各行の両端を
 * (グループ内の重複なら本体IDへ)置き換えた最終形を直接計算する。1件ずつ
 * pair-scopedで処理していた旧実装では、重複A・重複B同士の関係(どちらも本体では
 * ない)を「Aの処理時にA→本体への移設」として報告した後、dry-runでは何も
 * 書き込まれないため「Bの処理時」に同じ行をもう一度元の状態のまま読み、
 * 自己参照として検出できずに「moved」が二重に報告されるバグがあった
 * (--execute実行時は書き込みが永続化されるため最終的なDB状態自体は正しく
 * 収束するが、dry-runのレポートが実際の動作と食い違っていた)。 */
async function migrateRelationsForGroup(
  supabase: AdminClient,
  canonicalId: string,
  duplicateIds: string[],
  execute: boolean
): Promise<Map<string, { moved: number; droppedSelfRelation: number }>> {
  const resultByDup = new Map<string, { moved: number; droppedSelfRelation: number }>()
  for (const dupId of duplicateIds) resultByDup.set(dupId, { moved: 0, droppedSelfRelation: 0 })
  if (duplicateIds.length === 0) return resultByDup

  const orFilter = duplicateIds.map((id) => `artist_id_a.eq.${id},artist_id_b.eq.${id}`).join(',')
  const { data: relations, error: relationsError } = await supabase
    .from('artist_relation')
    .select('id, artist_id_a, artist_id_b')
    .or(orFilter)
  if (relationsError) throw new Error(`migrateRelationsForGroup(canonical=${canonicalId}) artist_relation: ${relationsError.message}`)

  const duplicateIdSet = new Set(duplicateIds)
  const remap = (id: string) => (duplicateIdSet.has(id) ? canonicalId : id)

  for (const r of relations ?? []) {
    // このグループの重複を指している側を報告の帰属先にする(a側が重複ならa側、
    // でなければb側。クエリ自体がいずれかの重複を含む行しか返さないため、
    // どちらか一方は必ず該当する)。重複行同士の関係(a・bどちらも重複)は
    // どちらか一方にのみ帰属させ、行としては1回しか処理しない。
    const involvedDupId = duplicateIdSet.has(r.artist_id_a) ? r.artist_id_a : r.artist_id_b
    const result = resultByDup.get(involvedDupId)
    if (!result) continue // 念のための防御(クエリ条件上ここには来ないはず)

    const newA = remap(r.artist_id_a)
    const newB = remap(r.artist_id_b)
    if (newA === newB) {
      result.droppedSelfRelation++
      if (execute) {
        const { error } = await supabase.from('artist_relation').delete().eq('id', r.id)
        if (error) console.warn(`    ⚠️ artist_relation(id=${r.id})の削除に失敗しました: ${error.message}`)
      }
    } else {
      result.moved++
      if (execute) {
        const { error } = await supabase.from('artist_relation').update({ artist_id_a: newA, artist_id_b: newB }).eq('id', r.id)
        if (error) console.warn(`    ⚠️ artist_relation(id=${r.id})の付け替えに失敗しました: ${error.message}`)
      }
    }
  }
  return resultByDup
}

/** artist.bio等のスカラー項目を、グループ全体を1回読んでまとめて補完する。
 * 本体の空フィールドを、pickCanonicalと同じ優先順位(compareCanonicalPriority:
 * track数→album数→副次データスコア→id)で並べた重複を順に見て、最初に
 * 見つかった非null値を採用する(スペック「優先順位1の重複行から順に見て、
 * 最初に見つかった非null値を採用」)。1件ずつpair-scopedで処理していた旧実装は
 * main()のループ順(id順)で重複を処理していたため、複数の重複が同じ
 * フィールドに異なる非null値を持つ場合、スペックが定める優先順位とは違う
 * 重複の値が採用されてしまう可能性があった(重複が1件しかない空スタブ49組
 * では影響が無いが、深刻3組のように重複が多数あるグループで問題になりうる)。 */
async function fillScalarFieldsForGroup(
  supabase: AdminClient,
  canonicalId: string,
  duplicateIdsInPriorityOrder: string[],
  execute: boolean
): Promise<{ filled: string[] }> {
  const FIELDS = [
    'bio', 'image_url', 'name_kana', 'name_en', 'formed_year', 'disbanded_year',
    'active_status', 'hometown_country', 'origin_prefecture', 'hometown_city',
    'official_site_url', 'sns_x_url', 'sns_instagram_url', 'apple_music_artist_id', 'spotify_artist_id',
  ]
  const allIds = [canonicalId, ...duplicateIdsInPriorityOrder]
  const { data: rows, error } = await supabase.from('artist').select(['id', ...FIELDS].join(',')).in('id', allIds)
  if (error) throw new Error(`fillScalarFieldsForGroup(canonical=${canonicalId}): ${error.message}`)

  // .select(['id', ...FIELDS].join(','))は動的な文字列のためSupabaseの型生成が
  // 列を解決できず`GenericStringError`型になる。実行時の値は問題ないので
  // unknown経由でキャストする(brief記載のRecord直接キャストはtscでTS2352に
  // なり型検査が通らないため、この形に修正)。
  const rowById = new Map(
    ((rows ?? []) as unknown as Array<Record<string, unknown>>).map((row) => [row.id as string, row])
  )
  const canonicalRow = rowById.get(canonicalId)
  if (!canonicalRow) return { filled: [] }

  const patch: Record<string, unknown> = {}
  const filled: string[] = []
  for (const field of FIELDS) {
    const canonicalValue = canonicalRow[field]
    if (canonicalValue !== null && canonicalValue !== '') continue // 本体に既に値がある項目は上書きしない
    for (const dupId of duplicateIdsInPriorityOrder) {
      const dupRow = rowById.get(dupId)
      if (!dupRow) continue
      const dupValue = dupRow[field]
      if (dupValue !== null && dupValue !== '') {
        patch[field] = dupValue
        filled.push(field)
        break // このフィールドは優先順位最上位の非null値で確定したので次のフィールドへ
      }
    }
  }
  if (filled.length > 0 && execute) {
    const { error: updateError } = await supabase.from('artist').update(patch).eq('id', canonicalId)
    if (updateError) console.warn(`    ⚠️ artist(id=${canonicalId})のスカラー項目補完に失敗しました: ${updateError.message}`)
  }
  return { filled }
}

/** 1グループ分(本体+同グループの重複全員)の副次データ(外部リンク・ジャンル・
 * 関係性・スカラー項目)を本体へ統合する。空スタブ49組はこれだけで完了する。
 * duplicateIdsは何番目に処理するかが結果に影響しうる(スカラー項目補完の
 * 優先順位に使う)ため、呼び出し側でcompareCanonicalPriority順に並べて渡す
 * こと。FK付け替え(album.artist_id等、track.artist_idを除く)とartist行の
 * 削除は重複間コリジョンの概念が無いためこの関数には含めず、main()内で
 * 従来どおり重複ごとにrepointForeignKeys/updateFkを呼ぶ。 */
async function mergeSecondaryData(
  supabase: AdminClient,
  canonicalId: string,
  duplicateIdsInPriorityOrder: string[],
  execute: boolean
) {
  const scalarResult = await fillScalarFieldsForGroup(supabase, canonicalId, duplicateIdsInPriorityOrder, execute)
  const linkResultByDuplicate = await migrateDedupedLinksForGroup(supabase, canonicalId, duplicateIdsInPriorityOrder, execute)
  const relationResultByDuplicate = await migrateRelationsForGroup(supabase, canonicalId, duplicateIdsInPriorityOrder, execute)
  return { scalarResult, linkResultByDuplicate, relationResultByDuplicate }
}

const DRY_RUN = !process.argv.includes('--execute')

async function main() {
  const supabase = createAdminClient()

  console.log('アーティストを集計中...')
  const allArtists = await fetchAllArtists(supabase)
  console.log(`  ${allArtists.length}件のアーティストを取得しました`)

  const idsByName = new Map<string, string[]>()
  for (const a of allArtists) {
    const list = idsByName.get(a.name) ?? []
    list.push(a.id)
    idsByName.set(a.name, list)
  }
  const duplicateArtistIds = [...idsByName.values()].filter((ids) => ids.length > 1).flat()

  console.log('重複候補アーティストのトラックタイトルを取得中...')
  const trackTitles = await fetchTrackTitlesForArtists(supabase, duplicateArtistIds)

  const groups = classifyGroups(allArtists, trackTitles)
  const stubGroups = groups.filter((g) => g.kind === 'stub')
  const severeGroups = groups.filter((g) => g.kind === 'severe')

  console.log(`\n対象: 空スタブ${stubGroups.length}組、深刻${severeGroups.length}組\n`)

  const artistById = new Map(allArtists.map((a) => [a.id, a]))

  for (const group of [...severeGroups, ...stubGroups]) {
    console.log(`=== ${group.name}(${group.kind}, ${group.artistIds.length}行) ===`)
    const rows = group.artistIds.map((id) => artistById.get(id)!).filter(Boolean)
    const candidates = await buildCandidates(supabase, rows)
    const canonical = pickCanonical(candidates)
    console.log(
      `  本体候補: ${canonical.id}(track=${canonical.trackCount}, album=${canonical.albumCount}) — 選定理由: ${explainCanonicalReason(canonical, candidates)}`
    )
    const duplicates = candidates.filter((c) => c.id !== canonical.id)
    // スカラー項目補完(fillScalarFieldsForGroup)はこの順序に従って
    // 「最初に見つかった非null値」を採用するため、pickCanonicalと同じ
    // 優先順位で並べてから渡す(リンク/ジャンル/関係性の移設自体は
    // どの順で重複を処理しても結果は変わらないが、fillScalarFieldsForGroupと
    // 同じ引数を使い回すためここで揃えておく)。
    const duplicateIdsInPriorityOrder = [...duplicates].sort(compareCanonicalPriority).map((c) => c.id)

    let groupMergeResult: Awaited<ReturnType<typeof mergeSecondaryData>> | null = null
    try {
      groupMergeResult = await mergeSecondaryData(supabase, canonical.id, duplicateIdsInPriorityOrder, !DRY_RUN)
      console.log(`  補完フィールド(グループ全体): [${groupMergeResult.scalarResult.filled.join(', ')}]`)
    } catch (err) {
      console.log(`  ❌ このグループの副次データ統合に失敗しました: ${(err as Error).message}`)
      console.log('  ⚠️ このグループの重複行は削除しません(副次データ統合に失敗したため)')
      continue
    }

    for (const c of duplicates) {
      console.log(
        `  重複: ${c.id}(track=${c.trackCount}, album=${c.albumCount}, link=${c.externalLinkCount}, genre=${c.genreCount}, relation=${c.relationCount}, mvlog=${c.mvBackfillLogCount})`
      )
      const linkResult = groupMergeResult.linkResultByDuplicate.get(c.id)!
      const relationResult = groupMergeResult.relationResultByDuplicate.get(c.id)!
      console.log(
        `    リンク移設${linkResult.linksMoved}件・重複削除${linkResult.linksDropped}件 / ジャンル移設${linkResult.genresMoved}件・重複削除${linkResult.genresDropped}件 / 関係性移設${relationResult.moved}件・自己参照削除${relationResult.droppedSelfRelation}件`
      )
      try {
        // updateFk自体がexecute=falseのときは書き込まず件数だけ数えるので、
        // ここでは無条件に呼んでよい。FK付け替えには重複間コリジョンの概念が
        // 無いため、リンク/ジャンル/関係性/スカラー項目と違いグループ全体を
        // まとめる必要が無く、従来どおり重複ごとにpair-scopedで呼ぶ。
        // 深刻3組(severe)はalbum.artist_idをここで付け替えず、
        // mergeAlbumsAndTracks側にタイトル一致でのアルバム統合・再割り当てを
        // 任せる(ARTIST_FK_REFERENCESのコメント参照。ここで先に付け替えて
        // しまうとmergeAlbumsAndTracksが重複のアルバムを1件も見つけられなくなる)。
        const artistFkReferencesForGroup =
          group.kind === 'severe'
            ? ARTIST_FK_REFERENCES.filter((r) => !(r.table === 'album' && r.column === 'artist_id'))
            : ARTIST_FK_REFERENCES
        const fkOutcomes = await repointForeignKeys(artistFkReferencesForGroup, c.id, canonical.id, (table, column, fromId, toId) =>
          updateFk(supabase, table, column, fromId, toId, !DRY_RUN)
        )
        // ARTIST_FK_REFERENCES経由で移設される各テーブルの件数(0件のものは省略)。
        // radio_rotation/ranking_entry/award_entry等、空スタブ組では0件のはずの
        // テーブルに非ゼロ件数が出た場合はここで気付けるようにする(スペック
        // 「安全確認」の必須報告項目)
        const nonZeroFks = fkOutcomes.filter((o) => o.status === 'ok' && (o.movedCount ?? 0) > 0)
        if (nonZeroFks.length > 0) {
          console.log(`    FK移設: ${nonZeroFks.map((f) => `${f.table}.${f.column}=${f.movedCount}件`).join(', ')}`)
        }
        // mergeAlbumsAndTracksのcatch-all(重複artist_idを持つ残りtrackの
        // 再割り当て)自体が失敗した場合、下のfailedFksチェックだけでは
        // 検知できない(artistFkReferencesForGroupはalbum.artist_id・
        // track.artist_idのどちらも含まないため)。track.artist_idはON DELETE
        // CASCADEなので、この失敗を見逃したままartist行を削除すると
        // 再割り当てし損ねたトラックがCASCADEで一緒に消えてしまう。そのため
        // このフラグをfailedFksと同じ削除ゲートに組み込む(下記参照)。
        let albumTrackHasFailure = false
        if (group.kind === 'severe') {
          const albumTrackResult = await mergeAlbumsAndTracks(supabase, canonical.id, c.id, !DRY_RUN)
          albumTrackHasFailure = albumTrackResult.catchAllFailed
          console.log(
            `    アルバム統合: ${albumTrackResult.matchedAlbums}件マッチ / トラック統合: ${albumTrackResult.tracksMatched}件マッチ(うちフィールド補完${albumTrackResult.tracksFieldFilled}件)・${albumTrackResult.tracksReassigned}件は本体へ再割り当て`
          )
          if (albumTrackResult.tracksReassignedViaCatchAll > 0) {
            console.log(
              `    あいまい/未対応アルバム・孤立トラックの再割り当て(catch-all): ${albumTrackResult.tracksReassignedViaCatchAll}件`
            )
          }
          if (albumTrackResult.ambiguousAlbumTitles.length > 0) {
            console.log(
              `    ⚠️ あいまいで未対応のアルバム(所属: 本体${canonical.id}/重複${c.id}): ${albumTrackResult.ambiguousAlbumTitles.join(', ')}`
            )
          }
          if (albumTrackResult.trackAmbiguousTitles.length > 0) {
            console.log(
              `    ⚠️ あいまいで未対応のトラック(所属: 本体${canonical.id}/重複${c.id}): ${albumTrackResult.trackAmbiguousTitles.join(', ')}`
            )
          }
          if (albumTrackResult.reassignedAlbums.length > 0) {
            console.log(`    再割り当てされたアルバム: ${albumTrackResult.reassignedAlbums.join(', ')}`)
          }
          if (albumTrackResult.reassignedTrackTitles.length > 0) {
            console.log(`    再割り当てされたトラック: ${albumTrackResult.reassignedTrackTitles.join(', ')}`)
          }
        }
        const failedFks = fkOutcomes.filter((o) => o.status === 'failed')
        if (failedFks.length > 0) {
          console.log(`    ⚠️ FK付け替え失敗: ${failedFks.map((f) => `${f.table}.${f.column}(${f.error})`).join(', ')}`)
          console.log('    ⚠️ この重複行は削除しません(付け替えに失敗した参照が残っているため)')
        } else if (albumTrackHasFailure) {
          console.log('    ⚠️ この重複行は削除しません(アルバム・トラック統合の一部処理に失敗したため)')
        } else if (!DRY_RUN) {
          const { error: deleteError } = await supabase.from('artist').delete().eq('id', c.id)
          if (deleteError) {
            console.log(`    ❌ 重複artist行の削除に失敗しました: ${deleteError.message}`)
          }
        }
      } catch (err) {
        console.log(`    ❌ この重複のFK付け替え処理に失敗しました: ${(err as Error).message}`)
      }
    }
  }

  console.log(`\n${DRY_RUN ? '[dry-run] 書き込みは行っていません。' : ''}`)
}

main()
