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
import { pickCanonical, secondaryDataScore, type ArtistCandidate } from '@/utils/artistDedupCanonical'
import { repointForeignKeys, type FkReference } from '@/utils/fkRepoint'

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
// 扱うためここには含めない)
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

/** artist_external_link・artist_genreを本体へ移設する。本体側と(link_type,url)/
 * genre_idが重複するものは移設せず削除する(スペック「3. 副次データの移設」)。 */
async function migrateDedupedLinks(supabase: AdminClient, canonicalId: string, duplicateId: string, execute: boolean) {
  const [
    { data: canonicalLinks, error: canonicalLinksError },
    { data: duplicateLinks, error: duplicateLinksError },
  ] = await Promise.all([
    supabase.from('artist_external_link').select('id, link_type, url').eq('artist_id', canonicalId),
    supabase.from('artist_external_link').select('id, link_type, url').eq('artist_id', duplicateId),
  ])
  // fetchSecondaryCounts/fetchTrackTitlesForArtistsで踏んだのと同じ失敗パターン
  // (エラーを無視すると`data`がnullになり`?? []`が本物の0件と区別なく通してしまい、
  // 移設件数が静かに0件と報告されてしまう)を避けるため、読み取り後に必ず
  // エラーを確認してから使う。
  if (canonicalLinksError)
    throw new Error(`migrateDedupedLinks(canonical=${canonicalId}) artist_external_link: ${canonicalLinksError.message}`)
  if (duplicateLinksError)
    throw new Error(`migrateDedupedLinks(duplicate=${duplicateId}) artist_external_link: ${duplicateLinksError.message}`)

  const canonicalKeys = new Set((canonicalLinks ?? []).map((l) => `${l.link_type}|${l.url}`))
  let moved = 0
  let dropped = 0
  for (const link of duplicateLinks ?? []) {
    const key = `${link.link_type}|${link.url}`
    if (canonicalKeys.has(key)) {
      dropped++
      if (execute) {
        const { error } = await supabase.from('artist_external_link').delete().eq('id', link.id)
        if (error) console.warn(`    ⚠️ artist_external_link(id=${link.id})の削除に失敗しました: ${error.message}`)
      }
    } else {
      moved++
      canonicalKeys.add(key)
      if (execute) {
        const { error } = await supabase.from('artist_external_link').update({ artist_id: canonicalId }).eq('id', link.id)
        if (error) console.warn(`    ⚠️ artist_external_link(id=${link.id})の付け替えに失敗しました: ${error.message}`)
      }
    }
  }

  const [
    { data: canonicalGenres, error: canonicalGenresError },
    { data: duplicateGenres, error: duplicateGenresError },
  ] = await Promise.all([
    supabase.from('artist_genre').select('genre_id').eq('artist_id', canonicalId),
    supabase.from('artist_genre').select('genre_id').eq('artist_id', duplicateId),
  ])
  if (canonicalGenresError)
    throw new Error(`migrateDedupedLinks(canonical=${canonicalId}) artist_genre: ${canonicalGenresError.message}`)
  if (duplicateGenresError)
    throw new Error(`migrateDedupedLinks(duplicate=${duplicateId}) artist_genre: ${duplicateGenresError.message}`)

  const canonicalGenreIds = new Set((canonicalGenres ?? []).map((g) => g.genre_id))
  let genresMoved = 0
  let genresDropped = 0
  for (const g of duplicateGenres ?? []) {
    if (canonicalGenreIds.has(g.genre_id)) {
      genresDropped++
      if (execute) {
        const { error } = await supabase.from('artist_genre').delete().eq('artist_id', duplicateId).eq('genre_id', g.genre_id)
        if (error) console.warn(`    ⚠️ artist_genre(artist_id=${duplicateId}, genre_id=${g.genre_id})の削除に失敗しました: ${error.message}`)
      }
    } else {
      genresMoved++
      canonicalGenreIds.add(g.genre_id)
      if (execute) {
        const { error } = await supabase
          .from('artist_genre')
          .update({ artist_id: canonicalId })
          .eq('artist_id', duplicateId)
          .eq('genre_id', g.genre_id)
        if (error)
          console.warn(`    ⚠️ artist_genre(artist_id=${duplicateId}, genre_id=${g.genre_id})の付け替えに失敗しました: ${error.message}`)
      }
    }
  }

  return { linksMoved: moved, linksDropped: dropped, genresMoved, genresDropped }
}

/** artist_relationを本体へ移設する。付け替えた結果artist_id_a===artist_id_bに
 * なる行(グループ内の重複行同士の関係だった場合)は削除する(スペック
 * 「3. 副次データの移設」)。 */
async function migrateRelations(supabase: AdminClient, canonicalId: string, duplicateId: string, execute: boolean) {
  const { data: relations, error: relationsError } = await supabase
    .from('artist_relation')
    .select('id, artist_id_a, artist_id_b')
    .or(`artist_id_a.eq.${duplicateId},artist_id_b.eq.${duplicateId}`)
  if (relationsError) throw new Error(`migrateRelations(duplicate=${duplicateId}) artist_relation: ${relationsError.message}`)

  let moved = 0
  let droppedSelfRelation = 0
  for (const r of relations ?? []) {
    const newA = r.artist_id_a === duplicateId ? canonicalId : r.artist_id_a
    const newB = r.artist_id_b === duplicateId ? canonicalId : r.artist_id_b
    if (newA === newB) {
      droppedSelfRelation++
      if (execute) {
        const { error } = await supabase.from('artist_relation').delete().eq('id', r.id)
        if (error) console.warn(`    ⚠️ artist_relation(id=${r.id})の削除に失敗しました: ${error.message}`)
      }
    } else {
      moved++
      if (execute) {
        const { error } = await supabase.from('artist_relation').update({ artist_id_a: newA, artist_id_b: newB }).eq('id', r.id)
        if (error) console.warn(`    ⚠️ artist_relation(id=${r.id})の付け替えに失敗しました: ${error.message}`)
      }
    }
  }
  return { moved, droppedSelfRelation }
}

/** artist.bio等のスカラー項目で、本体側がnull/空のものだけ重複側の値を
 * コピーする(スペック「2. スカラー項目の補完」)。 */
async function fillScalarFields(supabase: AdminClient, canonicalId: string, duplicateId: string, execute: boolean) {
  const FIELDS = [
    'bio', 'image_url', 'name_kana', 'name_en', 'formed_year', 'disbanded_year',
    'active_status', 'hometown_country', 'origin_prefecture', 'hometown_city',
    'official_site_url', 'sns_x_url', 'sns_instagram_url', 'apple_music_artist_id', 'spotify_artist_id',
  ]
  const [
    { data: canonicalRow, error: canonicalError },
    { data: duplicateRow, error: duplicateError },
  ] = await Promise.all([
    supabase.from('artist').select(FIELDS.join(',')).eq('id', canonicalId).single(),
    supabase.from('artist').select(FIELDS.join(',')).eq('id', duplicateId).single(),
  ])
  if (canonicalError) throw new Error(`fillScalarFields(canonical=${canonicalId}): ${canonicalError.message}`)
  if (duplicateError) throw new Error(`fillScalarFields(duplicate=${duplicateId}): ${duplicateError.message}`)
  if (!canonicalRow || !duplicateRow) return { filled: [] as string[] }

  const patch: Record<string, unknown> = {}
  const filled: string[] = []
  for (const field of FIELDS) {
    // .select(FIELDS.join(','))は動的な文字列のためSupabaseの型生成が列を
    // 解決できず`GenericStringError`型になる。実行時の値は問題ないので
    // unknown経由でキャストする(brief記載のRecord直接キャストはtscで
    // TS2352になり型検査が通らないため、この形に修正)。
    const canonicalValue = (canonicalRow as unknown as Record<string, unknown>)[field]
    const duplicateValue = (duplicateRow as unknown as Record<string, unknown>)[field]
    const canonicalEmpty = canonicalValue === null || canonicalValue === ''
    const duplicateHasValue = duplicateValue !== null && duplicateValue !== ''
    if (canonicalEmpty && duplicateHasValue) {
      patch[field] = duplicateValue
      filled.push(field)
    }
  }
  if (filled.length > 0 && execute) {
    const { error } = await supabase.from('artist').update(patch).eq('id', canonicalId)
    if (error) console.warn(`    ⚠️ artist(id=${canonicalId})のスカラー項目補完に失敗しました: ${error.message}`)
  }
  return { filled }
}

/** 1件の重複artist_idについて、副次データ(外部リンク・ジャンル・関係性・
 * MVログ・スカラー項目)を本体へ統合する。空スタブ49組はこれだけで完了する。 */
async function mergeSecondaryData(supabase: AdminClient, canonicalId: string, duplicateId: string, execute: boolean) {
  const scalarResult = await fillScalarFields(supabase, canonicalId, duplicateId, execute)
  const linkResult = await migrateDedupedLinks(supabase, canonicalId, duplicateId, execute)
  const relationResult = await migrateRelations(supabase, canonicalId, duplicateId, execute)
  // updateFk自体がexecute=falseのときは書き込まず件数だけ数えるので、ここでは
  // 無条件に呼んでよい(mergeSecondaryDataの他の関数はそれぞれ内部でexecuteを
  // 見て書き込みを分岐しているのに対し、こちらはupdateFk自身がdry-run安全)
  const fkOutcomes = await repointForeignKeys(ARTIST_FK_REFERENCES, duplicateId, canonicalId, (table, column, fromId, toId) =>
    updateFk(supabase, table, column, fromId, toId, execute)
  )
  return { scalarResult, linkResult, relationResult, fkOutcomes }
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
    for (const c of candidates) {
      if (c.id === canonical.id) continue
      console.log(
        `  重複: ${c.id}(track=${c.trackCount}, album=${c.albumCount}, link=${c.externalLinkCount}, genre=${c.genreCount}, relation=${c.relationCount}, mvlog=${c.mvBackfillLogCount})`
      )
      try {
        const result = await mergeSecondaryData(supabase, canonical.id, c.id, !DRY_RUN)
        console.log(
          `    補完フィールド: [${result.scalarResult.filled.join(', ')}] / リンク移設${result.linkResult.linksMoved}件・重複削除${result.linkResult.linksDropped}件 / ジャンル移設${result.linkResult.genresMoved}件・重複削除${result.linkResult.genresDropped}件 / 関係性移設${result.relationResult.moved}件・自己参照削除${result.relationResult.droppedSelfRelation}件`
        )
        // ARTIST_FK_REFERENCES経由で移設される各テーブルの件数(0件のものは省略)。
        // radio_rotation/ranking_entry/award_entry等、空スタブ組では0件のはずの
        // テーブルに非ゼロ件数が出た場合はここで気付けるようにする(スペック
        // 「安全確認」の必須報告項目)
        const nonZeroFks = result.fkOutcomes.filter((o) => o.status === 'ok' && (o.movedCount ?? 0) > 0)
        if (nonZeroFks.length > 0) {
          console.log(`    FK移設: ${nonZeroFks.map((f) => `${f.table}.${f.column}=${f.movedCount}件`).join(', ')}`)
        }
        const failedFks = result.fkOutcomes.filter((o) => o.status === 'failed')
        if (failedFks.length > 0) {
          console.log(`    ⚠️ FK付け替え失敗: ${failedFks.map((f) => `${f.table}.${f.column}(${f.error})`).join(', ')}`)
          console.log('    ⚠️ この重複行は削除しません(付け替えに失敗した参照が残っているため)')
        } else if (!DRY_RUN) {
          const { error: deleteError } = await supabase.from('artist').delete().eq('id', c.id)
          if (deleteError) {
            console.log(`    ❌ 重複artist行の削除に失敗しました: ${deleteError.message}`)
          }
        }
      } catch (err) {
        console.log(`    ❌ このグループの処理に失敗しました: ${(err as Error).message}`)
      }
    }
  }

  console.log(`\n${DRY_RUN ? '[dry-run] 書き込みは行っていません。' : ''}`)
}

main()
