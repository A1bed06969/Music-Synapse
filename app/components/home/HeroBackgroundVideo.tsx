'use client'

import { useEffect, useRef } from 'react'

/** トップページ全体に固定表示する背景動画。順再生+逆再生を繋げたファイル
 * (public/images/record-digging/home-background.mp4)を使っているため、
 * 単純なloop属性でも繋ぎ目が目立たない。
 *
 * 動画の色味(ネイビー・シアン・マゼンタ・コーラルが常に位置を変える)は
 * 彩度が高く、明るい色がテキストの真下に来る瞬間もあるため、上に暗めの
 * オーバーレイを重ねて常時読みやすさを確保する。 */
export default function HeroBackgroundVideo() {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // OS側で「視差効果を減らす」設定が有効なユーザーには、動画を止めて
    // 最初のコマ(poster)のまま静止表示する
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const applyMotionPreference = () => {
      if (mediaQuery.matches) {
        video.pause()
      } else {
        video.play().catch(() => {
          // 一部ブラウザは自動再生をブロックすることがあるが、
          // 背景演出の失敗はページ表示自体を妨げないので無視してよい
        })
      }
    }
    applyMotionPreference()
    mediaQuery.addEventListener('change', applyMotionPreference)
    return () => mediaQuery.removeEventListener('change', applyMotionPreference)
  }, [])

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        src="/images/record-digging/home-background.mp4"
        poster="/images/record-digging/home-background-poster.jpg"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
      />
      <div className="absolute inset-0 bg-black/55" />
    </div>
  )
}
