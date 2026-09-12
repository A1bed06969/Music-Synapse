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
    }
  }

  console.log(`\n${DRY_RUN ? '[dry-run] 書き込みは行っていません。' : ''}`)
}

main()
