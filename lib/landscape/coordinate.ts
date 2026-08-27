// Artistデータ → Landscape座標、の変換ロジックだけをUIから独立させたファイル。
// UI側(LandscapeView.tsx)はここが返す{x, y}を受け取るだけで、座標の
// 算出方法(現在はルールベース)を一切知らない。将来Embedding+UMAPへ
// 置き換える際は、このファイルの中身だけを差し替えれば済む(仕様29番)。

import type { LineageEdge } from '@/utils/genreHistory'
import { getGenreAnchor, type Vector2 } from './genreAnchors'
import { seededJitter, seededOffset2D } from './jitter'

export type LandscapePosition = Vector2

function clamp(v: number, min = -1, max = 1): number {
  return Math.max(min, Math.min(max, v))
}

/** genre_lineageの親子関係から、あるジャンルIDの最終的なルートジャンルIDを
 * 決定論的に辿る。複数の親を持つ場合(crossoverエッジ等)は、最初に見つかった
 * derivationエッジを優先して1本だけ辿る(GenreEvolutionツリー構築時の
 * 「最初に見つかったエッジが親として確定する」規約と揃えている)。
 * 循環参照防止のためvisitedで打ち切る。 */
export function resolveRootGenreId(genreId: string, edges: LineageEdge[]): string {
  const parentsByChild = new Map<string, LineageEdge[]>()
  for (const e of edges) {
    const list = parentsByChild.get(e.childGenreId) ?? []
    list.push(e)
    parentsByChild.set(e.childGenreId, list)
  }

  let currentId = genreId
  const visited = new Set<string>()
  for (;;) {
    if (visited.has(currentId)) break
    visited.add(currentId)
    const parents = parentsByChild.get(currentId)
    if (!parents || parents.length === 0) break
    const derivationParent = parents.find((p) => p.relationType === 'derivation') ?? parents[0]
    currentId = derivationParent.parentGenreId
  }
  return currentId
}

/** resolveRootGenreIdの結果をジャンル名に変換するだけのラッパー。 */
export function resolveRootGenreName(
  genreId: string,
  genreNameById: Map<string, string>,
  edges: LineageEdge[]
): string | null {
  return genreNameById.get(resolveRootGenreId(genreId, edges)) ?? null
}

export type LandscapeCoordinateInput = {
  /** Deterministic Jitterの種に使う一意なID(通常はartistId) */
  seedId: string
  /** Genre Anchorの基準になるルートジャンル名(未分類ならnull) */
  rootGenreName: string | null
  /** 実際にタグ付けされた具体ジャンル名。rootGenreNameと同じ場合は
   * Subgenre Offsetを適用しない(そのアーティスト自身がルートジャンルの
   * 代表例であることを意味するため) */
  specificGenreName: string | null
}

/**
 * Artist Position = Genre Anchor + Subgenre Offset + Deterministic Jitter
 *
 * Tag Offsetは、このDBにfreeformなTagテーブルが存在しないためMVPでは
 * 未実装(仕様39番が許容する「Tagが無い」ケースとして扱う)。将来Tagテーブルが
 * 追加された場合は、ここにsubgenreOffsetと同じ要領でtagOffsetを足すだけでよい。
 *
 * dbAnchors: genre.landscape_x/y(genre_lineageからのUMAP埋め込み、仕様29番の
 * ステップ2)を呼び出し側が1回だけ読み込んで渡すマップ。渡さない場合は
 * getGenreAnchorの手動アンカー/キーワード推定にフォールバックする。
 */
export function calculateLandscapePosition(
  input: LandscapeCoordinateInput,
  dbAnchors?: Map<string, Vector2>
): LandscapePosition {
  const anchor = getGenreAnchor(input.rootGenreName, dbAnchors)

  const isRootItself =
    !input.specificGenreName || !input.rootGenreName || input.specificGenreName.toLowerCase() === input.rootGenreName.toLowerCase()
  const subgenreOffset = isRootItself ? { x: 0, y: 0 } : seededOffset2D(input.specificGenreName!, 0.18)

  const jitter = seededJitter(input.seedId, 0.05)

  return {
    x: clamp(anchor.x + subgenreOffset.x + jitter.x),
    y: clamp(anchor.y + subgenreOffset.y + jitter.y),
  }
}

/**
 * リーフジャンル(子ジャンルの無いノード)専用の位置算出。階層ズームでリーフまで
 * 絞り込むと対象は全員同じジャンルなので、Genre Anchorで差をつける意味が無い
 * (全員同じ点に重なってしまう)。原点を中心に個体ジッターだけを画面いっぱいに
 * 広げて使う(同じアーティストは毎回同じ位置になる決定論性は維持)。
 */
export function calculateLeafArtistPosition(seedId: string): LandscapePosition {
  const jitter = seededJitter(seedId, 0.85)
  return { x: clamp(jitter.x), y: clamp(jitter.y) }
}
