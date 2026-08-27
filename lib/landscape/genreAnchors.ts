// ジャンルごとの基準座標(Genre Anchor)。
// X軸: Organic(-1) ←→ Electronic(+1)
// Y軸: Traditional(-1) ←→ Experimental(+1)
//
// 完全な音楽的正解を狙わず、人間が見て「確かにこの辺にいそう」と感じられる
// 大まかな配置を優先する(仕様書40番)。値は手動でチューニング可能。
//
// 主要ジャンル(このDBで実際にgenre_highlight/artist_genreの蓄積がある
// ルートジャンル)は手動でアンカーを用意し、それ以外の未知のジャンル名は
// キーワードスコアリング+ハッシュジッターでフォールバック座標を出す
// (DB内のルートジャンルは150件あり、全てを手動列挙するのは非現実的なため)。

import { seededJitter } from './jitter'

export type Vector2 = { x: number; y: number }

export const GENRE_ANCHORS: Record<string, Vector2> = {
  // --- Organic / Traditional 寄り ---
  bluegrass: { x: -0.9, y: -0.75 },
  country: { x: -0.85, y: -0.65 },
  folk: { x: -0.8, y: -0.6 },
  'bossa nova': { x: -0.7, y: -0.45 },
  blues: { x: -0.7, y: -0.5 },
  reggae: { x: -0.6, y: -0.4 },
  ska: { x: -0.6, y: -0.3 },
  afrobeat: { x: -0.65, y: -0.15 },
  soul: { x: -0.55, y: -0.3 },
  'r&b': { x: -0.35, y: -0.25 },
  gospel: { x: -0.6, y: -0.55 },
  classical: { x: -0.5, y: -0.15 },

  // --- Organic寄りだが実験性が高い ---
  jazz: { x: -0.4, y: 0.2 },
  tropicalia: { x: -0.55, y: 0.4 },
  shoegaze: { x: -0.3, y: 0.5 },
  metal: { x: -0.35, y: 0.6 },
  punk: { x: -0.55, y: 0.05 },
  'punk rock': { x: -0.55, y: 0.05 },
  rock: { x: -0.3, y: -0.05 },

  // --- 中間帯 ---
  funk: { x: -0.15, y: 0.0 },
  'hip hop': { x: 0.05, y: 0.1 },
  pop: { x: 0.1, y: -0.5 },
  'j-pop': { x: 0.25, y: -0.45 },

  // --- Electronic寄り ---
  balearic: { x: 0.4, y: -0.1 },
  house: { x: 0.65, y: 0.1 },
  amapiano: { x: 0.55, y: 0.3 },
  disco: { x: 0.5, y: -0.35 },
  ambient: { x: 0.55, y: 0.65 },
  techno: { x: 0.85, y: 0.45 },
  rave: { x: 0.9, y: 0.6 },
  vaporwave: { x: 0.6, y: 0.75 },
  jungle: { x: 0.75, y: 0.2 },
  'drum and bass': { x: 0.8, y: 0.25 },
  electronic: { x: 0.7, y: 0.3 },
}

const UNCLASSIFIED_ANCHOR: Vector2 = { x: -0.05, y: -0.9 }

// キーワードスコアリング: アンカー未登録のジャンル名から大まかな座標を
// 推定するための単純なルール。将来Embeddingへ置き換える際は、この
// 関数(estimateAnchorFromName)ごと差し替えるだけで済むようにする。
const ELECTRONIC_KEYWORDS = [
  'electro', 'techno', 'house', 'edm', 'synth', 'digital', 'disco', 'dance',
  'club', 'bass', 'dubstep', 'garage', 'trance', 'idm', 'wave', 'pop',
]
const ORGANIC_KEYWORDS = [
  'folk', 'acoustic', 'blues', 'country', 'bluegrass', 'jazz', 'soul',
  'gospel', 'roots', 'unplugged', 'singer-songwriter', 'classical', 'chamber',
]
const EXPERIMENTAL_KEYWORDS = [
  'avant', 'noise', 'experimental', 'free ', 'drone', 'industrial', 'art ',
  'psychedelic', 'prog', 'sound art', 'glitch', 'grind', 'harsh',
]
const TRADITIONAL_KEYWORDS = [
  'traditional', 'classic', 'old-time', 'roots', 'cowboy', 'gospel', 'oldies',
]

function keywordScore(nameLower: string, keywords: string[]): number {
  return keywords.some((k) => nameLower.includes(k)) ? 1 : 0
}

/** アンカー未登録のジャンル名から、キーワード一致+名前ハッシュのジッターで
 * それらしい座標を推定する。何のヒントも無い名前は原点付近に薄く散らばる。 */
function estimateAnchorFromName(nameLower: string): Vector2 {
  const electronicScore = keywordScore(nameLower, ELECTRONIC_KEYWORDS)
  const organicScore = keywordScore(nameLower, ORGANIC_KEYWORDS)
  const experimentalScore = keywordScore(nameLower, EXPERIMENTAL_KEYWORDS)
  const traditionalScore = keywordScore(nameLower, TRADITIONAL_KEYWORDS)

  let x = 0
  if (electronicScore && !organicScore) x = 0.5
  else if (organicScore && !electronicScore) x = -0.5
  else if (electronicScore && organicScore) x = 0

  let y = 0
  if (experimentalScore && !traditionalScore) y = 0.5
  else if (traditionalScore && !experimentalScore) y = -0.5
  else if (experimentalScore && traditionalScore) y = 0

  // 何もヒットしなかった名前は、原点付近にハッシュベースで薄く散らす
  // (常に同じ名前なら同じ位置になる決定論性は維持)
  if (x === 0 && y === 0) {
    const j = seededJitter(`unknown-genre:${nameLower}`, 0.35)
    return { x: j.x, y: j.y }
  }

  // ヒットしたジャンルにも少しだけ名前由来のジッターを足し、
  // 同カテゴリの複数ジャンルが完全に重ならないようにする
  const j = seededJitter(`genre-nudge:${nameLower}`, 0.12)
  return { x: x + j.x, y: y + j.y }
}

/** ジャンル名(表記ゆれを吸収するため小文字化して照合)から基準座標を返す。
 * dbAnchors(genre.landscape_x/yから作ったUMAP埋め込みのマップ)に該当する
 * エントリがあれば最優先で使う。無ければ手動アンカー、それも無ければ
 * キーワード推定にフォールバックする(仕様29番: embeddingへの置き換え後も
 * genre_lineageにエッジの無いジャンルは推定が必要なため、3段構成のまま残す)。 */
export function getGenreAnchor(genreName: string | null, dbAnchors?: Map<string, Vector2>): Vector2 {
  if (!genreName) return UNCLASSIFIED_ANCHOR
  const key = genreName.trim().toLowerCase()
  if (dbAnchors?.has(key)) return dbAnchors.get(key)!
  if (GENRE_ANCHORS[key]) return GENRE_ANCHORS[key]
  return estimateAnchorFromName(key)
}

export { UNCLASSIFIED_ANCHOR }
