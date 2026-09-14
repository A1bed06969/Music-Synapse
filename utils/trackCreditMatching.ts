// フィーチャリング曲が異なるartist_idに分散登録されている行を検出する純粋関数。
// apple_music_track_idが両側にあればそれを優先(最も確実な外部ID一致)、
// 無ければtitle+albumTitle+trackNo+durationSecondsで完全一致を検出する。
// trackNo/durationSecondsについては両方nullの場合のみ一致；片方nullの場合は異なる値。
// 同一artist_id内に一致行が複数ある場合(同名異版等)は推測せず「あいまい」として
// スキップする。docs/superpowers/specs/2026-09-14-track-artist-unification-design.md
// 「検出・マッチング基準」参照。

export type TrackCreditRow = {
  id: string
  artistId: string
  appleMusicTrackId: string | null
  title: string
  albumId: string
  albumTitle: string
  trackNo: number | null
  durationSeconds: number | null
}

export type CreditGroup = { rows: TrackCreditRow[] }
export type GroupResult = { groups: CreditGroup[]; ambiguousKeys: string[] }

function fallbackKey(r: TrackCreditRow): string {
  return JSON.stringify([r.title, r.albumTitle, r.trackNo, r.durationSeconds])
}

function buildGroups(rows: TrackCreditRow[], keyOf: (r: TrackCreditRow) => string): GroupResult {
  const byKey = new Map<string, TrackCreditRow[]>()
  for (const r of rows) {
    const list = byKey.get(keyOf(r)) ?? []
    list.push(r)
    byKey.set(keyOf(r), list)
  }

  const groups: CreditGroup[] = []
  const ambiguousKeys: string[] = []
  for (const [key, groupRows] of byKey) {
    const artistCounts = new Map<string, number>()
    for (const r of groupRows) {
      artistCounts.set(r.artistId, (artistCounts.get(r.artistId) ?? 0) + 1)
    }
    const hasSameArtistDuplicate = [...artistCounts.values()].some((c) => c > 1)
    if (hasSameArtistDuplicate) {
      ambiguousKeys.push(key)
      continue
    }
    const distinctArtists = new Set(groupRows.map((r) => r.artistId))
    if (distinctArtists.size < 2) continue // 単独artist内の重複や単一行はこの関数の対象外
    groups.push({ rows: groupRows })
  }
  return { groups, ambiguousKeys }
}

export function groupTrackCredits(rows: TrackCreditRow[]): GroupResult {
  const withAppleId = rows.filter((r) => r.appleMusicTrackId !== null)
  const withoutAppleId = rows.filter((r) => r.appleMusicTrackId === null)

  const primary = buildGroups(withAppleId, (r) => `apple:${r.appleMusicTrackId}`)
  const fallback = buildGroups(withoutAppleId, fallbackKey)

  return {
    groups: [...primary.groups, ...fallback.groups],
    ambiguousKeys: [...primary.ambiguousKeys, ...fallback.ambiguousKeys],
  }
}
