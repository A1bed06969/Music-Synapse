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

/**
 * Match rows by exact title, flagging ambiguity when either side has multiple rows
 * for the same title. Only matches when both sides have exactly one row for that title.
 */
function matchByExactTitle<T extends { id: string; title: string }>(
  canonicalRows: T[],
  duplicateRows: T[]
): MatchResult {
  const matched: { canonicalId: string; duplicateId: string }[] = []
  const ambiguousTitles: string[] = []
  const canonicalByTitle = groupByTitle(canonicalRows)
  const duplicateByTitle = groupByTitle(duplicateRows)

  // Iterate over the UNION of both sides' title keys
  const titles = new Set([...canonicalByTitle.keys(), ...duplicateByTitle.keys()])
  for (const title of titles) {
    const cList = canonicalByTitle.get(title) ?? []
    const dList = duplicateByTitle.get(title) ?? []
    // Flag as ambiguous if either side has more than one row for this title
    if (cList.length > 1 || dList.length > 1) {
      ambiguousTitles.push(title)
    } else if (cList.length === 1 && dList.length === 1) {
      // Only match if both sides have exactly one row
      matched.push({ canonicalId: cList[0].id, duplicateId: dList[0].id })
    }
    // else: one side has exactly 0 or 1 and the other has 0 — no match, not ambiguous, fine as-is
  }
  return { matched, ambiguousTitles }
}

export function matchAlbums(canonicalAlbums: AlbumRow[], duplicateAlbums: AlbumRow[]): MatchResult {
  return matchByExactTitle(canonicalAlbums, duplicateAlbums)
}

function trackTupleKey(t: TrackRow): string {
  return `${t.title}|${t.disc_number}|${t.track_no}`
}

export function matchTracks(canonicalTracks: TrackRow[], duplicateTracks: TrackRow[]): MatchResult {
  const matched: { canonicalId: string; duplicateId: string }[] = []
  const usedCanonical = new Set<string>()
  const usedDuplicate = new Set<string>()

  // 第1階層: タイトル + disc_number + track_no が両側とも設定されていて、1:1で一致
  const canonicalByTuple = new Map<string, TrackRow[]>()
  for (const c of canonicalTracks) {
    if (c.disc_number === null || c.track_no === null) continue
    const key = trackTupleKey(c)
    const list = canonicalByTuple.get(key) ?? []
    list.push(c)
    canonicalByTuple.set(key, list)
  }

  const duplicateByTuple = new Map<string, TrackRow[]>()
  for (const d of duplicateTracks) {
    if (d.disc_number === null || d.track_no === null) continue
    const key = trackTupleKey(d)
    const list = duplicateByTuple.get(key) ?? []
    list.push(d)
    duplicateByTuple.set(key, list)
  }

  // Only match 1:1 tuple groups (no double-matching)
  for (const [key, cList] of canonicalByTuple) {
    const dList = duplicateByTuple.get(key)
    if (dList && cList.length === 1 && dList.length === 1) {
      matched.push({ canonicalId: cList[0].id, duplicateId: dList[0].id })
      usedCanonical.add(cList[0].id)
      usedDuplicate.add(dList[0].id)
    }
  }

  // 第2階層: 第1階層で未対応のものだけを対象に、タイトルのみで対応付ける
  const remainingCanonical = canonicalTracks.filter((c) => !usedCanonical.has(c.id))
  const remainingDuplicate = duplicateTracks.filter((d) => !usedDuplicate.has(d.id))
  const tier2Result = matchByExactTitle(remainingCanonical, remainingDuplicate)
  matched.push(...tier2Result.matched)

  return { matched, ambiguousTitles: tier2Result.ambiguousTitles }
}
