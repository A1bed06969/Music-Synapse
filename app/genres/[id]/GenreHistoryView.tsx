'use client'

import { useState } from 'react'
import type { GenreHistoryViewProps } from './genreHistoryTypes'
import EraTimeline from './EraTimeline'
import EraDetailPanel from './EraDetailPanel'
import GenreEvolution from './GenreEvolution'

export default function GenreHistoryView({ genreName, eraCards, evolutionNodes, evolutionEdges }: GenreHistoryViewProps) {
  const [selectedGenreId, setSelectedGenreId] = useState<string | null>(eraCards[0]?.genreId ?? null)
  const selectedCard = eraCards.find((c) => c.genreId === selectedGenreId) ?? null

  return (
    <div className="animate-[fadein_0.3s_ease-in]">
      <EraTimeline cards={eraCards} selectedGenreId={selectedGenreId} onSelect={setSelectedGenreId} />

      {selectedCard && <EraDetailPanel key={selectedCard.genreId} card={selectedCard} />}

      {evolutionNodes.length > 1 && (
        <div className="mt-10 border-t border-white/10 pt-8">
          <h2 className="text-lg font-semibold">GENRE EVOLUTION</h2>
          <p className="mt-1 text-xs text-white/40">{genreName}からのジャンルの派生・影響関係</p>
          <GenreEvolution nodes={evolutionNodes} edges={evolutionEdges} />
        </div>
      )}
    </div>
  )
}
