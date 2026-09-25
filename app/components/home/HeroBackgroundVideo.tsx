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

    // 以前はOSの「視差効果を減らす」設定を尊重して一時停止していたが、
    // その設定が有効な環境で背景が静止画+再生ボタンの状態に見えてしまい
    // 「動画が壊れている」ように受け取られたため、常に再生する形に戻した。
    // 音は鳴らず(muted)、ループする装飾なので、静止させる必然性は低いと判断している。
    //
    // muted+playsInline+autoPlayを揃えていても、低電力モード・データセーバー・
    // バックグラウンドタブからの復帰直後などでplay()がrejectされることがあり
    // (ブラウザ側のヒューリスティック依存で発生が不定期)、以前はここで諦めた
    // ままリトライが無かった。ユーザー報告(2026-09-22、「時々自動再生されない」)を
    // 受け、初回タップ/スクロール操作とタブ復帰のタイミングで再試行するようにする。
    let retrying = false
    function tryPlay() {
      if (retrying || !video || !video.paused) return
      retrying = true
      video.play().catch(() => {
        // それでも失敗する場合(ネットワーク未読み込み等)は静止画のままで許容する
      }).finally(() => {
        retrying = false
      })
    }

    tryPlay()

    const retryEvents: (keyof DocumentEventMap)[] = ['pointerdown', 'touchstart', 'scroll']
    for (const eventName of retryEvents) {
      document.addEventListener(eventName, tryPlay, { passive: true })
    }
    document.addEventListener('visibilitychange', tryPlay)

    return () => {
      for (const eventName of retryEvents) {
        document.removeEventListener(eventName, tryPlay)
      }
      document.removeEventListener('visibilitychange', tryPlay)
    }
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
