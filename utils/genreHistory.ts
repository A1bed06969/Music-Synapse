// utils/genreHistory.ts
//
// ジャンル年表(カード型UI)のコアロジック。DB行(genre/genre_lineage/genre_highlight)を
// カード表示用のデータへ変換する純粋関数群。app/genres/[id]/page.tsxはこのファイルの
// 関数にデータを渡すだけで、ロジック自体はここに閉じ込める(テスト容易性のため)。

export type LineageEdge = {
  parentGenreId: string
  childGenreId: string
  relationType: 'derivation' | 'influence' | 'crossover'
}

export type GenreRow = {
  id: string
  name: string
  originYear: number | null
  originYearLabel: string | null
  originCountry: string | null
  backgroundNote: string | null
}

export type HighlightRow = {
  genreId: string
  artistId: string | null
  artistName: string | null
  artistImageUrl: string | null
  albumId: string | null
  albumTitle: string | null
  albumJacketUrl: string | null
  eventYear: number | null
  eventYearLabel: string | null
  note: string | null
}

export type EraColorToken = 'amber' | 'yellow' | 'green' | 'blue' | 'coral' | 'purple'

const ERA_COLOR_ROTATION: EraColorToken[] = ['amber', 'yellow', 'green', 'blue', 'coral', 'purple']

export type EraCardData = {
  genreId: string
  period: string
  title: string
  region: string | null
  colorToken: EraColorToken
  description: string | null
  representativeArtists: { id: string; name: string; imageUrl: string | null }[]
  representativeWorks: { id: string; title: string; year: number | null; artistName: string | null; imageUrl: string | null }[]
  imageUrl: string | null
}

/** rootId自身を含めた、genre_lineageを辿った全子孫のIDをBFS順で返す。
 * 循環参照があっても無限ループしないようseenで防御する。 */
export function getDescendantGenreIds(rootId: string, edges: LineageEdge[]): string[] {
  const childrenByParent = new Map<string, string[]>()
  for (const edge of edges) {
    const list = childrenByParent.get(edge.parentGenreId) ?? []
    list.push(edge.childGenreId)
    childrenByParent.set(edge.parentGenreId, list)
  }

  const result: string[] = [rootId]
  const seen = new Set<string>([rootId])
  const queue: string[] = [rootId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const child of childrenByParent.get(current) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      result.push(child)
      queue.push(child)
    }
  }
  return result
}

/** rootIdジャンル自身+その全子孫(再帰的)を、origin_year昇順のERAカード列に変換する。
 * 各カードの代表アーティスト/作品は、そのカード自身のジャンルIDに直接紐づく
 * genre_highlightのみを使う(子孫分は合算しない。カード列挙は再帰的だが、
 * カード1枚ごとの中身は非再帰的)。 */
export function buildEraCards(
  rootId: string,
  genres: GenreRow[],
  edges: LineageEdge[],
  highlights: HighlightRow[]
): EraCardData[] {
  const descendantIds = getDescendantGenreIds(rootId, edges)
  const genreById = new Map(genres.map((g) => [g.id, g]))
  const orderIndex = new Map(descendantIds.map((id, i) => [id, i]))

  const withYear = descendantIds
    .map((id) => genreById.get(id))
    .filter((g): g is GenreRow => g !== undefined && g.originYear !== null)

  const sorted = [...withYear].sort((a, b) => {
    if (a.originYear! !== b.originYear!) return a.originYear! - b.originYear!
    return orderIndex.get(a.id)! - orderIndex.get(b.id)!
  })

  return sorted.map((genreRow, index) => {
    const genreHighlights = highlights.filter((h) => h.genreId === genreRow.id)

    const representativeArtists = genreHighlights
      .filter((h): h is HighlightRow & { artistId: string; artistName: string } => h.artistId !== null && h.artistName !== null)
      .map((h) => ({ id: h.artistId, name: h.artistName, imageUrl: h.artistImageUrl }))

    const representativeWorks = genreHighlights
      .filter((h): h is HighlightRow & { albumId: string; albumTitle: string } => h.albumId !== null && h.albumTitle !== null)
      .map((h) => ({
        id: h.albumId,
        title: h.albumTitle,
        year: h.eventYear ?? genreRow.originYear,
        artistName: h.artistName,
        imageUrl: h.albumJacketUrl,
      }))

    const imageUrl =
      genreHighlights.find((h) => h.artistImageUrl)?.artistImageUrl ??
      genreHighlights.find((h) => h.albumJacketUrl)?.albumJacketUrl ??
      null

    return {
      genreId: genreRow.id,
      period: genreRow.originYearLabel ?? (genreRow.originYear ? `${genreRow.originYear}年` : ''),
      title: genreRow.name,
      region: genreRow.originCountry,
      colorToken: ERA_COLOR_ROTATION[index % ERA_COLOR_ROTATION.length],
      description: genreRow.backgroundNote,
      representativeArtists,
      representativeWorks,
      imageUrl,
    }
  })
}

export type GenreEvolutionNode = {
  genreId: string
  name: string
  depth: number
  incomingRelationType: 'derivation' | 'influence' | 'crossover' | null
}

export type GenreEvolutionEdgeData = {
  fromGenreId: string
  toGenreId: string
  relationType: 'derivation' | 'influence' | 'crossover'
}

/** rootIdを根とする系統ツリーを、深さ優先(pre-order)でノード列とエッジ列に変換する。
 * pre-order(親の直後にその子が並ぶ)にしておくことで、UI側は単純な配列の
 * map()だけで入れ子リスト表示ができる。 */
export function buildGenreEvolutionTree(
  rootId: string,
  genres: GenreRow[],
  edges: LineageEdge[]
): { nodes: GenreEvolutionNode[]; edges: GenreEvolutionEdgeData[] } {
  const genreById = new Map(genres.map((g) => [g.id, g]))
  const childrenByParent = new Map<string, LineageEdge[]>()
  for (const edge of edges) {
    const list = childrenByParent.get(edge.parentGenreId) ?? []
    list.push(edge)
    childrenByParent.set(edge.parentGenreId, list)
  }

  const nodes: GenreEvolutionNode[] = []
  const resultEdges: GenreEvolutionEdgeData[] = []
  const seen = new Set<string>()

  function visit(genreId: string, depth: number, incomingRelationType: 'derivation' | 'influence' | 'crossover' | null) {
    if (seen.has(genreId)) return
    seen.add(genreId)
    const genreRow = genreById.get(genreId)
    nodes.push({ genreId, name: genreRow?.name ?? genreId, depth, incomingRelationType })
    for (const edge of childrenByParent.get(genreId) ?? []) {
      resultEdges.push({ fromGenreId: edge.parentGenreId, toGenreId: edge.childGenreId, relationType: edge.relationType })
      visit(edge.childGenreId, depth + 1, edge.relationType)
    }
  }
  visit(rootId, 0, null)

  return { nodes, edges: resultEdges }
}
