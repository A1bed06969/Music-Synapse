// Genre単位で色を割り当てる。増やしすぎると見分けがつかなくなるため、
// 彩度・明度を散らした固定パレットを用意し、未知のジャンル名はハッシュで
// 決定論的に割り当てる(RelationGraph.tsxのcolorForCategoryと同じ考え方)。

const PALETTE = [
  '#e85d5d', // レッド
  '#e8a63c', // アンバー
  '#7fc97f', // グリーン
  '#5aa9e6', // スカイブルー
  '#b57bdc', // パープル
  '#e0c341', // イエロー
  '#4fc3c0', // ティール
  '#e77fa8', // ピンク
  '#9fb85f', // オリーブ
  '#e08a5f', // テラコッタ
]

export const UNCLASSIFIED_COLOR = 'rgba(255,255,255,0.35)'

function hashString(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0
  }
  return hash
}

export function colorForGenre(genreName: string | null): string {
  if (!genreName) return UNCLASSIFIED_COLOR
  return PALETTE[hashString(genreName.toLowerCase()) % PALETTE.length]
}
