'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'

// モーダルはWeb Audio・スワイプ判定込みでそれなりの重さがあるため、開くまで
// バンドルに含めない(全ページで読み込まれるランチャー自体は軽く保つ)
const RecordDiggingModal = dynamic(() => import('./RecordDiggingModal'), { ssr: false })

export default function RecordDiggingLauncher() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Junkie Dig"
        className="fixed bottom-5 right-5 z-40 w-56 shrink-0 overflow-hidden rounded-2xl shadow-lg shadow-black/50 transition hover:scale-[1.03]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/record-digging/junkie-dig-banner.png"
          alt="Junkie Dig"
          className="block h-auto w-full"
          draggable={false}
        />
      </button>
      {open && <RecordDiggingModal onClose={() => setOpen(false)} />}
    </>
  )
}
