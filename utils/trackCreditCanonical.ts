// utils/trackCreditCanonical.ts
//
// 重複track候補の中から、非nullの補完可能フィールド数が最も多い行を本体として
// 選ぶ純粋関数。docs/superpowers/specs/2026-09-14-track-artist-unification-design.md
// 「本体(canonical)track/albumの選定」参照。

export type EnrichmentFields = {
  youtubeVideoId: string | null
  previewUrl: string | null
  appleMusicTrackId: string | null
  spotifyTrackId: string | null
  youtubeMusicTrackId: string | null
  amazonMusicTrackId: string | null
  lyricUrl: string | null
  trackReview: string | null
}

export type CanonicalCandidate = { id: string; artistId: string; enrichment: EnrichmentFields }

function nonNullCount(e: EnrichmentFields): number {
  return Object.values(e).filter((v) => v !== null && v !== '').length
}

export function pickCanonicalTrack(candidates: CanonicalCandidate[]): CanonicalCandidate {
  if (candidates.length === 0) {
    throw new Error('pickCanonicalTrack: candidates は1件以上必要です')
  }
  return [...candidates].sort((a, b) => {
    const diff = nonNullCount(b.enrichment) - nonNullCount(a.enrichment)
    if (diff !== 0) return diff
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })[0]
}
