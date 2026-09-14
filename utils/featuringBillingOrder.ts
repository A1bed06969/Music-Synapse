// utils/featuringBillingOrder.ts
//
// トラックタイトルから"(feat. A, B)"/"[feat. A, B]"パターンを抽出し、
// グループ内アーティストの表示順(billing_order)を決める純粋関数。
// docs/superpowers/specs/2026-09-14-track-artist-unification-design.md
// 「表示順(billing_order)の決定」参照。表示順は安全性(データ損失)に
// 影響しないため、抽出できない場合はベストエフォートでrichnessScore→id文字列
// 比較にフォールバックする(推測してよい数少ない箇所)。

const FEAT_PATTERN = /[([]feat\.?\s+([^)\]]+)[)\]]/i

export function extractFeaturedNames(title: string): string[] | null {
  const match = title.match(FEAT_PATTERN)
  if (!match) return null
  const inner = match[1]
  // "A, B & C" のようなカンマ・アンパサンド混在を分割する
  return inner
    .split(/,|&/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export type BillingCandidate = { artistId: string; artistName: string; richnessScore: number }
export type BillingEntry = { artistId: string; role: 'main' | 'featured'; billingOrder: number }

export function determineBillingOrder(title: string, candidates: BillingCandidate[]): BillingEntry[] {
  const featuredNames = extractFeaturedNames(title)

  if (featuredNames) {
    const featuredSet = new Set(featuredNames.map((n) => n.trim()))
    const nonFeatured = candidates.filter((c) => !featuredSet.has(c.artistName.trim()))
    const featured = candidates.filter((c) => featuredSet.has(c.artistName.trim()))

    // グループ内の誰か1名だけがfeat.リストの「外」にいる場合のみ、タイトル解析による
    // 判定を信頼する(0名または全員がfeat.リストに含まれる場合は判定材料にならない)
    if (nonFeatured.length === 1 && featured.length === candidates.length - 1) {
      const primary = nonFeatured[0]
      const orderedFeatured = [...featured].sort(
        (a, b) => featuredNames.indexOf(a.artistName.trim()) - featuredNames.indexOf(b.artistName.trim())
      )
      return [
        { artistId: primary.artistId, role: 'main', billingOrder: 1 },
        ...orderedFeatured.map((c, i) => ({ artistId: c.artistId, role: 'featured' as const, billingOrder: i + 2 })),
      ]
    }
  }

  // フォールバック: richnessScore降順、同点ならid文字列比較
  const sorted = [...candidates].sort((a, b) => {
    if (b.richnessScore !== a.richnessScore) return b.richnessScore - a.richnessScore
    return a.artistId < b.artistId ? -1 : a.artistId > b.artistId ? 1 : 0
  })
  return sorted.map((c, i) => ({
    artistId: c.artistId,
    role: i === 0 ? 'main' : 'featured',
    billingOrder: i + 1,
  }))
}
