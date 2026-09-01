'use client'

import { createContext, useContext, useRef, useState, type ReactNode } from 'react'

type PreviewPlayerContextValue = {
  /** 現在試聴再生中のtrackId(1つだけ保持し、切り替えると前の曲は自動的に止まる) */
  playingTrackId: string | null
  /** 再生中トラックの再生位置(0〜1)。PreviewButtonの円形プログレスリング表示に使う。 */
  progress: number
  /** trackIdの試聴を開始する。audio要素はプロバイダ側で1つだけ共有しているため、
   * 同じtrackIdを指すPreviewButtonが画面上に複数マウントされていても
   * (例: レスポンシブ切り替えでモバイル用・デスクトップ用を両方DOMに持つ場合)
   * 二重再生にはならない。 */
  play: (trackId: string, previewUrl: string) => void
  stop: () => void
}

const PreviewPlayerContext = createContext<PreviewPlayerContextValue | null>(null)

export function PreviewPlayerProvider({ children }: { children: ReactNode }) {
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  function play(trackId: string, previewUrl: string) {
    const audio = audioRef.current
    if (!audio) return
    audio.src = previewUrl
    setProgress(0)
    audio
      .play()
      .then(() => setPlayingTrackId(trackId))
      .catch(() => {
        // 自動再生ブロックなどで再生に失敗した場合は再生状態を解除する
        setPlayingTrackId(null)
      })
  }

  function stop() {
    audioRef.current?.pause()
    setPlayingTrackId(null)
  }

  function handleTimeUpdate() {
    const audio = audioRef.current
    if (!audio || !audio.duration) return
    setProgress(audio.currentTime / audio.duration)
  }

  return (
    <PreviewPlayerContext.Provider value={{ playingTrackId, progress, play, stop }}>
      {children}
      <audio
        ref={audioRef}
        preload="none"
        onEnded={() => setPlayingTrackId(null)}
        onTimeUpdate={handleTimeUpdate}
      />
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
