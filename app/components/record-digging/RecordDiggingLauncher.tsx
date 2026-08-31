'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { Caveat } from 'next/font/google'
import JacketFanIcon from './JacketFanIcon'

// モーダルはWeb Audio・スワイプ判定込みでそれなりの重さがあるため、開くまで
// バンドルに含めない(全ページで読み込まれるランチャー自体は軽く保つ)
const RecordDiggingModal = dynamic(() => import('./RecordDiggingModal'), { ssr: false })

// サイト全体のGeist Sansには影響させず、このバナーのロゴ部分だけに使う手書き風書体
const caveat = Caveat({ subsets: ['latin'], weight: '700' })

export default function RecordDiggingLauncher() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-amber-400/30 bg-[#1a120b]/90 py-2 pl-2 pr-4 shadow-lg shadow-black/50 backdrop-blur transition hover:bg-[#241a10]"
      >
        <JacketFanIcon className="h-9 w-auto shrink-0" />
        <span className={`${caveat.className} text-xl leading-none tracking-wide text-amber-200`}>Junkie Dig</span>
      </button>
      {open && <RecordDiggingModal onClose={() => setOpen(false)} />}
    </>
  )
}
