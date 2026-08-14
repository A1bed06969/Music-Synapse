'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'
import type { MapCategory, MapMarker } from './LeafletMap'

const LeafletMap = dynamic(() => import('./LeafletMap'), { ssr: false })

const TABS: { value: MapCategory; label: string }[] = [
  { value: 'artist', label: 'アーティスト' },
  { value: 'venue', label: 'ライブ会場' },
  { value: 'shop', label: 'レコードショップ' },
]

export default function TabbedMapView({ markers }: { markers: MapMarker[] }) {
  const [activeTab, setActiveTab] = useState<MapCategory>('artist')
  const [focusId, setFocusId] = useState<string | null>(null)

  const filteredMarkers = useMemo(() => markers.filter((m) => m.category === activeTab), [markers, activeTab])

  function selectTab(tab: MapCategory) {
    setActiveTab(tab)
    setFocusId(null)
  }

  return (
    <div>
      <div className="flex gap-1 border-b border-white/10 pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => selectTab(tab.value)}
            className={`rounded px-3 py-1.5 text-sm transition ${
              activeTab === tab.value ? 'bg-white text-black' : 'text-white/60 hover:text-white'
            }`}
          >
            {tab.label}
            <span className="ml-1.5 text-xs opacity-60">
              {markers.filter((m) => m.category === tab.value).length}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-4 lg:flex-row">
        <div className="lg:flex-1">
          <LeafletMap
            markers={filteredMarkers}
            focusId={focusId}
            onMarkerHover={(id) => setFocusId(id ?? null)}
            onMarkerClick={setFocusId}
          />
        </div>
        <div className="lg:w-72 lg:shrink-0">
          <div className="max-h-[600px] overflow-y-auto rounded-lg border border-white/10">
            {filteredMarkers.length === 0 ? (
              <p className="p-4 text-sm text-white/40">該当するデータがありません。</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {filteredMarkers.map((marker) => (
                  <li key={marker.id}>
                    <button
                      type="button"
                      onClick={() => setFocusId(marker.id)}
                      onMouseEnter={() => setFocusId(marker.id)}
                      className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition hover:bg-white/5 ${
                        focusId === marker.id ? 'bg-white/10' : ''
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: marker.color }}
                      />
                      <span className="truncate">{marker.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
