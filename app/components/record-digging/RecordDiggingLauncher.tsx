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
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-amber-400/30 bg-[#1a120b]/90 px-4 py-2.5 text-xs font-semibold tracking-wide text-amber-200 shadow-lg shadow-black/50 backdrop-blur transition hover:bg-[#241a10]"
      >
        🎧 Junkie Dig
      </button>
      {open && <RecordDiggingModal onClose={() => setOpen(false)} />}
    </>
  )
}
