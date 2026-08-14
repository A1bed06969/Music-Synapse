'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

type PreviewPlayerContextValue = {
  /** 現在試聴再生中のtrackId(1つだけ保持し、切り替えると前の曲は自動的に止まる) */
  playingTrackId: string | null
  setPlayingTrackId: (trackId: string | null) => void
}

const PreviewPlayerContext = createContext<PreviewPlayerContextValue | null>(null)

export function PreviewPlayerProvider({ children }: { children: ReactNode }) {
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null)
  return (
    <PreviewPlayerContext.Provider value={{ playingTrackId, setPlayingTrackId }}>
      {children}
    </PreviewPlayerContext.Provider>
  )
}

export function usePreviewPlayer(): PreviewPlayerContextValue {
  const ctx = useContext(PreviewPlayerContext)
  if (!ctx) {
    throw new Error('usePreviewPlayer must be used within a PreviewPlayerProvider')
  }
  return ctx
}
