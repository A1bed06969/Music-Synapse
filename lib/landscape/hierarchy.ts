// ミュージックランドスケープの階層ズームナビゲーション(全音楽→ジャンル→
// サブジャンル→アーティスト)用のジャンル木ヘルパー。genre_lineageの
// derivationエッジだけを親子関係として使う(crossover/influenceは横のつながり
// なので階層には含めない。resolveRootGenreNameと同じ方針)。

import type { LineageEdge } from '@/utils/genreHistory'

export type GenreNode = { id: string; name: string }

/** あるジャンルIDの直接の子(derivationエッジの子側)一覧を返す。 */
export function getDerivationChildren(genreId: string, edges: LineageEdge[]): string[] {
  return edges.filter((e) => e.parentGenreId === genreId && e.relationType === 'derivation').map((e) => e.childGenreId)
}

/** あるジャンルIDを根とするサブツリー全体(自分自身を含む)のジャンルID集合を返す。
 * 循環防止のためvisitedで打ち切る。 */
export function getSubtreeGenreIds(genreId: string, edges: LineageEdge[]): Set<string> {
  const result = new Set<string>([genreId])
  const queue = [genreId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const childId of getDerivationChildren(current, edges)) {
      if (result.has(childId)) continue
      result.add(childId)
      queue.push(childId)
    }
  }
  return result
}

/** URLのパスセグメント(ジャンルID配列)が、ルートから順にderivationの
 * 親子関係として辻褄が合っているかを検証する。合っていれば末尾ノードの
 * IDを、合っていなければnullを返す(呼び出し側で404にする)。 */
export function resolveGenrePath(path: string[], edges: LineageEdge[], genreIds: Set<string>): string | null {
  if (path.length === 0) return null
  for (const id of path) {
    if (!genreIds.has(id)) return null
  }
  for (let i = 1; i < path.length; i++) {
    const children = getDerivationChildren(path[i - 1], edges)
    if (!children.includes(path[i])) return null
  }
  return path[path.length - 1]
}
