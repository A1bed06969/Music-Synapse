'use client'

import dynamic from 'next/dynamic'
import { X } from 'lucide-react'
import { useJunkieDig } from './JunkieDigContext'

// モーダルはWeb Audio・スワイプ判定込みでそれなりの重さがあるため、開くまで
// バンドルに含めない(全ページで読み込まれるランチャー自体は軽く保つ)
const RecordDiggingModal = dynamic(() => import('./RecordDiggingModal'), { ssr: false })

export default function RecordDiggingLauncher() {
  const { open, hidden, openJunkieDig, closeJunkieDig, hideBanner } = useJunkieDig()

  return (
    <>
      {!hidden && (
        <div className="fixed bottom-5 right-5 z-40 w-44 shrink-0 sm:w-56">
          <button
            type="button"
            onClick={openJunkieDig}
            aria-label="Junkie Dig"
            className="block w-full overflow-hidden rounded-2xl shadow-lg shadow-black/50 transition hover:scale-[1.03]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/record-digging/junkie-dig-banner.png"
              alt="Junkie Dig"
              className="block h-auto w-full"
              draggable={false}
            />
          </button>
          {/* バナーごと非表示にしたい人向けの閉じるボタン。一度閉じても
           * メニューの「Junkie Dig」からいつでもモーダルは開けるようにしている。 */}
          <button
            type="button"
            onClick={hideBanner}
            aria-label="Junkie Digのバナーを非表示にする"
            className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-black/80 text-white/70 shadow transition hover:bg-black hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {open && <RecordDiggingModal onClose={closeJunkieDig} />}
    </>
  )
}
