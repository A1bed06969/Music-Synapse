// utils/artistDedupMatching.ts
//
// 重複アーティストのアルバム・トラックを、タイトル完全一致で対応付ける
// 純粋関数。同名が複数あって一意に決まらない場合は推測せず「あいまい」として
// 除外する(誤統合よりも取りこぼしを優先する)。
// docs/superpowers/specs/2026-09-12-artist-dedup-design.md「4. アルバムの
// 対応付け」「5. トラックの対応付け」参照。

export type AlbumRow = { id: string; title: string }
export type TrackRow = { id: string; title: string; disc_number: number | null; track_no: number | null }
export type MatchResult = { matched: { canonicalId: string; duplicateId: string }[]; ambiguousTitles: string[] }

function groupByTitle<T extends { title: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const list = map.get(row.title) ?? []
    list.push(row)
    map.set(row.title, list)
  }
  return map
}

export function matchAlbums(canonicalAlbums: AlbumRow[], duplicateAlbums: AlbumRow[]): MatchResult {
  const matched: { canonicalId: string; duplicateId: string }[] = []
  const ambiguousTitles: string[] = []

  const canonicalByTitle = groupByTitle(canonicalAlbums)
  const duplicateByTitle = groupByTitle(duplicateAlbums)

  for (const [title, cList] of canonicalByTitle) {
    const dList = duplicateByTitle.get(title)
    if (!dList || dList.length === 0) continue
    if (cList.length === 1 && dList.length === 1) {
      matched.push({ canonicalId: cList[0].id, duplicateId: dList[0].id })
    } else {
      ambiguousTitles.push(title)
    }
  }

  return { matched, ambiguousTitles }
}

export function matchTracks(canonicalTracks: TrackRow[], duplicateTracks: TrackRow[]): MatchResult {
  const matched: { canonicalId: string; duplicateId: string }[] = []
  const usedCanonical = new Set<string>()
  const usedDuplicate = new Set<string>()

  // 第1階層: タイトル + disc_number + track_no が両側とも設定されていて一致
  for (const c of canonicalTracks) {
    if (c.disc_number === null || c.track_no === null) continue
    const candidates = duplicateTracks.filter(
      (d) => d.title === c.title && d.disc_number === c.disc_number && d.track_no === c.track_no
    )
    if (candidates.length === 1) {
      matched.push({ canonicalId: c.id, duplicateId: candidates[0].id })
      usedCanonical.add(c.id)
      usedDuplicate.add(candidates[0].id)
    }
  }

  // 第2階層: 第1階層で未対応のものだけを対象に、タイトルのみで対応付ける
  const remainingCanonical = canonicalTracks.filter((c) => !usedCanonical.has(c.id))
  const remainingDuplicate = duplicateTracks.filter((d) => !usedDuplicate.has(d.id))
  const canonicalByTitle = groupByTitle(remainingCanonical)
  const duplicateByTitle = groupByTitle(remainingDuplicate)
  const ambiguousTitles: string[] = []

  for (const [title, cList] of canonicalByTitle) {
    const dList = duplicateByTitle.get(title)
    if (!dList || dList.length === 0) continue
    if (cList.length === 1 && dList.length === 1) {
      matched.push({ canonicalId: cList[0].id, duplicateId: dList[0].id })
    } else {
      ambiguousTitles.push(title)
    }
  }

  return { matched, ambiguousTitles }
}
