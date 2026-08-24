// app/genres/[id]/genreHistoryTypes.ts
//
// GenreHistoryView以下のコンポーネントが受け取るprops契約。
// utils/genreHistory.tsの型をそのまま再エクスポートし、UIとデータ取得の境界を明示する。

export type { EraCardData, EraColorToken, GenreEvolutionNode, GenreEvolutionEdgeData } from '@/utils/genreHistory'

import type { EraCardData, GenreEvolutionNode, GenreEvolutionEdgeData } from '@/utils/genreHistory'

export type GenreHistoryViewProps = {
  genreName: string
  eraCards: EraCardData[]
  evolutionNodes: GenreEvolutionNode[]
  evolutionEdges: GenreEvolutionEdgeData[]
}
