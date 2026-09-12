// utils/artistDedupCanonical.ts
//
// 重複アーティストの中から「本体」として残す1行を選ぶ純粋関数。優先順位は
// (1)track数 (2)album数 (3)副次データスコア (4)id文字列比較の順(決定的にする
// ための最終手段)。docs/superpowers/specs/2026-09-12-artist-dedup-design.md
// 「1. 本体(canonical)行の選定」参照。

export type ArtistCandidate = {
  id: string
  trackCount: number
  albumCount: number
  externalLinkCount: number
  genreCount: number
  relationCount: number
  mvBackfillLogCount: number
  hasBio: boolean
  hasImage: boolean
}

/** 外部リンク・ジャンル・関係性・MVログの件数に、bio/image_urlの有無を1件分
 * 加算した「副次データの豊富さ」スコア。track/album数が同数のときの
 * タイブレークに使う。 */
export function secondaryDataScore(c: ArtistCandidate): number {
  return (
    c.externalLinkCount +
    c.genreCount +
    c.relationCount +
    c.mvBackfillLogCount +
    (c.hasBio ? 1 : 0) +
    (c.hasImage ? 1 : 0)
  )
}

/** track数→album数→副次データスコア→id文字列の優先順位で2つの候補を比較する
 * comparator。pickCanonicalの本体選定だけでなく、複数の重複行がある場合に
 * スカラー項目補完をどの順で処理するか(dedupe-artists.ts参照。スペック
 * 「優先順位1の重複行から順に見て、最初に見つかった非null値を採用」)にも
 * 同じ優先順位が必要なため、単独の関数として公開する。 */
export function compareCanonicalPriority(a: ArtistCandidate, b: ArtistCandidate): number {
  if (b.trackCount !== a.trackCount) return b.trackCount - a.trackCount
  if (b.albumCount !== a.albumCount) return b.albumCount - a.albumCount
  const scoreDiff = secondaryDataScore(b) - secondaryDataScore(a)
  if (scoreDiff !== 0) return scoreDiff
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function pickCanonical(candidates: ArtistCandidate[]): ArtistCandidate {
  if (candidates.length === 0) {
    throw new Error('pickCanonical: candidates は1件以上必要です')
  }
  return [...candidates].sort(compareCanonicalPriority)[0]
}
