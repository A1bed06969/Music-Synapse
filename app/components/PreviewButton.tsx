'use client'

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

// 円形プログレスリング用。viewBoxは固定にして、実際の見た目のサイズはCSS側
// (SIZE_CLASSのh-*/w-*)に委ねる。
const RING_RADIUS = 17
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

export default function PreviewButton({
  previewUrl,
  trackId,
  size = 'md',
}: {
  previewUrl: string | null
  trackId: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const { playingTrackId, progress, play, stop } = usePreviewPlayer()
  const isPlaying = playingTrackId === trackId

  if (!previewUrl) return null

  function toggle() {
    if (isPlaying) {
      stop()
    } else if (previewUrl) {
      play(trackId, previewUrl)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isPlaying ? '一時停止' : '試聴する'}
      className={`relative flex ${SIZE_CLASS[size]} shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white transition hover:border-white/30 hover:bg-white/10`}
    >
      {isPlaying && (
        <svg viewBox="0 0 40 40" className="pointer-events-none absolute inset-0 h-full w-full -rotate-90">
          <circle cx="20" cy="20" r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
          <circle
            cx="20"
            cy="20"
            r={RING_RADIUS}
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
          />
        </svg>
      )}
      {isPlaying ? (
        <Pause size={ICON_SIZE[size]} fill="currentColor" />
      ) : (
        <Play size={ICON_SIZE[size]} fill="currentColor" className="ml-0.5" />
      )}
    </button>
  )
}
