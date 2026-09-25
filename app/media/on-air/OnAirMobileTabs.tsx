'use client'

import { useState, type ReactNode } from 'react'

type TabKey = 'ranking' | 'map' | 'entries'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'ranking', label: 'ランキング' },
  { key: 'map', label: 'マップ' },
  { key: 'entries', label: 'エントリ一覧' },
]

/** モバイル(lg:未満)専用。デスクトップでは左/中央/右に横並びのランキング・
 * マップ・エントリ一覧を、タブで切り替えて表示する(2026-09-23、ユーザー報告
 * 「タイトル直下のランキングが長く、マップまで辿り着くのに大量スクロールが
 * 必要」を受けて追加)。 */
export default function OnAirMobileTabs({
  ranking,
  map,
  entries,
}: {
  ranking: ReactNode
  map: ReactNode
  entries: ReactNode
}) {
  const [active, setActive] = useState<TabKey>('ranking')
  const content = { ranking, map, entries }[active]

  return (
    <div className="mt-6">
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActive(tab.key)}
            className={`rounded-md py-2 text-xs font-medium transition ${
              active === tab.key ? 'bg-white text-black' : 'text-white/60 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="mt-6">{content}</div>
    </div>
  )
}
