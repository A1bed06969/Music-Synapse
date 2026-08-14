'use client'

import { useEffect, useRef } from 'react'
import { Play, Pause } from 'lucide-react'
import { usePreviewPlayer } from './PreviewPlayerContext'

const SIZE_CLASS = {
  sm: 'h-7 w-7',
  md: 'h-9 w-9',
  lg: 'h-11 w-11',
} as const

const ICON_SIZE = {
  sm: 14,
  md: 16,
  lg: 20,
} as const

export default function PreviewButton({
  previewUrl,
  trackId,
  size = 'md',
}: {
  previewUrl: string | null
  trackId: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const { playingTrackId, setPlayingTrackId } = usePreviewPlayer()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const isPlaying = playingTrackId === trackId

  // playingTrackIdが自分以外に切り替わったら、自分のaudioを止める
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.play().catch(() => {
        // 自動再生ブロックなどで再生に失敗した場合は再生状態を解除する
        setPlayingTrackId(null)
      })
    } else {
      audio.pause()
    }
  }, [isPlaying, setPlayingTrackId])

  if (!previewUrl) return null

  function toggle() {
    setPlayingTrackId(isPlaying ? null : trackId)
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label={isPlaying ? '一時停止' : '試聴する'}
        className={`flex ${SIZE_CLASS[size]} shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white transition hover:border-white/30 hover:bg-white/10`}
      >
        {isPlaying ? (
          <Pause size={ICON_SIZE[size]} fill="currentColor" />
        ) : (
          <Play size={ICON_SIZE[size]} fill="currentColor" className="ml-0.5" />
        )}
      </button>
      <audio ref={audioRef} src={previewUrl} preload="none" onEnded={() => setPlayingTrackId(null)} />
    </>
  )
}
