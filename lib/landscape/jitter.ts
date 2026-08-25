// 同じ座標にアーティストが重ならないよう加える微小なズレ。Math.random()は
// リロードのたびに位置が変わってしまい「地図」として成立しないため使わない。
// artistId文字列だけを種にした決定論的な疑似乱数(mulberry32)で、
// 同じアーティストは常に同じズレになる。

function hashStringToSeed(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** mulberry32: 小さく高速な決定論的PRNG。0以上1未満を返す。 */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Jitter = { x: number; y: number }

/** seedString(通常はartistId)から、[-magnitude, +magnitude]の範囲で
 * 決定論的なx/yのズレを生成する。 */
export function seededJitter(seedString: string, magnitude = 0.05): Jitter {
  const rand = mulberry32(hashStringToSeed(seedString))
  const x = (rand() * 2 - 1) * magnitude
  const y = (rand() * 2 - 1) * magnitude
  return { x, y }
}

/** ジャンル名などの文字列から、[-magnitude, +magnitude]の決定論的な
 * オフセット(x, y独立)を1つの数値として得たいときに使う(Subgenre Offset用)。 */
export function seededOffset2D(seedString: string, magnitude: number): Jitter {
  return seededJitter(`offset:${seedString}`, magnitude)
}
