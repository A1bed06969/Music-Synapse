'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'
import type { MapCategory, MapMarker } from './LeafletMap'
import ArtistOriginMap, { type ArtistOriginRow } from './ArtistOriginMap'
import type { NaturalEarthCountryFeature } from '@/utils/artistOriginMap'
import type { BoundaryCodeSet } from '@/utils/artistOriginBoundary'
import { createContext, useContext, type ReactNode } from 'react'
import SectionHeading from '@/app/components/detail/SectionHeading'
import { hubContent } from '@/app/components/hub/hubContents'

const LeafletMap = dynamic(() => import('./LeafletMap'), { ssr: false })

// 一覧は先頭だけ描画する(アーティストは5千件超で、全件描くとブラウザが重くなり地図の読み込みが進まない)
const LIST_LIMIT = 200

const TABS: { value: MapCategory; label: string }[] = [
  { value: 'artist', label: 'アーティスト' },
  { value: 'venue', label: 'ライブ会場' },
  { value: 'shop', label: 'レコードショップ' },
]

function useMapState({
  markers,
  artistOriginRows,
  countryFeatures,
  boundaryCodeSet,
}: {
  markers: MapMarker[]
  artistOriginRows: ArtistOriginRow[]
  countryFeatures: NaturalEarthCountryFeature[]
  boundaryCodeSet: BoundaryCodeSet
}) {
  const [activeTab, setActiveTab] = useState<MapCategory>('artist')
  const [focusId, setFocusId] = useState<string | null>(null)
  // アーティストタブで地図を大陸・国まで掘り下げている時は、一覧もその範囲のアーティストだけにする
  const [artistScope, setArtistScope] = useState<Set<string> | null>(null)

  const filteredMarkers = useMemo(() => markers.filter((m) => m.category === activeTab), [markers, activeTab])
  const listMarkers = useMemo(
    () =>
      activeTab === 'artist' && artistScope
        ? filteredMarkers.filter((m) => artistScope.has(m.id.replace(/^artist-/, '')))
        : filteredMarkers,
    [filteredMarkers, activeTab, artistScope]
  )

  function selectTab(tab: MapCategory) {
    setActiveTab(tab)
    setFocusId(null)
  }
  return { markers, artistOriginRows, countryFeatures, boundaryCodeSet, activeTab, focusId, setFocusId, setArtistScope, filteredMarkers, listMarkers, selectTab }
}

type MapState = ReturnType<typeof useMapState>
const MapStateContext = createContext<MapState | null>(null)

function useMap(): MapState {
  const v = useContext(MapStateContext)
  if (!v) throw new Error('MapStateProvider の外では使えません')
  return v
}

/** マップページの状態(選択中のレイヤー・フォーカス・一覧の範囲)を、中央の地図と右カラムのレイヤー切替・一覧で共有する。
 * 3カラムの枠(HubShell)はサーバー側のページで組み、その中身だけをこの下のクライアント部品にする。 */
export function MapStateProvider({
  markers,
  artistOriginRows,
  countryFeatures,
  boundaryCodeSet,
  children,
}: {
  markers: MapMarker[]
  artistOriginRows: ArtistOriginRow[]
  countryFeatures: NaturalEarthCountryFeature[]
  boundaryCodeSet: BoundaryCodeSet
  children: ReactNode
}) {
  const state = useMapState({ markers, artistOriginRows, countryFeatures, boundaryCodeSet })
  return <MapStateContext.Provider value={state}>{children}</MapStateContext.Provider>
}

export function MapTabs() {
  const { markers, activeTab, selectTab } = useMap()
  const c = hubContent('planet')
  return (
    <div>
      <p className="text-[11px] tracking-[0.2em] text-white/40">LAYER</p>
      <ul className="mt-3 flex flex-wrap gap-2 lg:flex-col lg:gap-0.5">
        {TABS.map((tab) => {
          const active = activeTab === tab.value
          return (
            <li key={tab.value}>
              <button
                type="button"
                onClick={() => selectTab(tab.value)}
                className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-[13px] font-bold tracking-wide transition ${active ? 'text-white' : 'text-white/70 hover:bg-white/[0.04] hover:text-white'}`}
                style={active ? { backgroundColor: `${c.color}29`, boxShadow: `inset 3px 0 0 ${c.color}` } : undefined}
              >
                {tab.label}
                <span className="ml-auto text-xs opacity-60">{markers.filter((m) => m.category === tab.value).length}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function MapList() {
  const { listMarkers, focusId, setFocusId } = useMap()
  return (
    <div>
      <p className="mb-3 text-[11px] tracking-[0.2em] text-white/40">LIST</p>
          <div className="max-h-[480px] overflow-y-auto rounded-lg border border-white/10">
            {listMarkers.length === 0 ? (
              <p className="p-4 text-sm text-white/40">該当するデータがありません。</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {listMarkers.slice(0, LIST_LIMIT).map((marker) => (
                  <li key={marker.id}>
                    <button
                      type="button"
                      onClick={() => setFocusId(marker.id)}
                      onMouseEnter={() => setFocusId(marker.id)}
                      className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition hover:bg-white/5 ${
                        focusId === marker.id ? 'bg-white/10' : ''
                      }`}
                    >
                      {marker.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={marker.imageUrl}
                          alt=""
                          className="h-7 w-7 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: marker.color }}
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate">{marker.label}</span>
                      {marker.region && (
                        <span className="shrink-0 text-xs text-white/40">{marker.region}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {listMarkers.length > LIST_LIMIT && (
              <p className="border-t border-white/5 p-3 text-xs text-white/40">ほか{listMarkers.length - LIST_LIMIT}件。地図で大陸・国を選ぶと絞り込まれます。</p>
            )}
          </div>
    </div>
  )
}

export function MapCanvas() {
  const { activeTab, artistOriginRows, countryFeatures, boundaryCodeSet, focusId, setFocusId, setArtistScope, filteredMarkers } = useMap()
  const c = hubContent('planet')
  const tabLabel = TABS.find((t) => t.value === activeTab)?.label ?? ''
  return (
    <>
      <SectionHeading number={c.number} label={tabLabel === 'アーティスト' ? 'ARTIST ORIGINS' : tabLabel === 'ライブ会場' ? 'LIVE VENUES' : 'RECORD SHOPS'} color={c.color} />
          {activeTab === 'artist' ? (
            <ArtistOriginMap
              artists={artistOriginRows}
              countryFeatures={countryFeatures}
              boundaryCodeSet={boundaryCodeSet}
              // 側リストのmarker.idは他タブと共通の`artist-${id}`形式だが、
              // ArtistOriginRow.idは/artists/${id}リンク生成にそのまま使う生のIDなので、
              // ここで相互変換してArtistOriginMapに橋渡しする
              selectedArtistId={focusId ? focusId.replace(/^artist-/, '') : null}
              onSelectArtist={(id) => setFocusId(id ? `artist-${id}` : null)}
              onScopeChange={setArtistScope}
            />
          ) : (
            <LeafletMap
              markers={filteredMarkers}
              focusId={focusId}
              onMarkerHover={(id) => setFocusId(id ?? null)}
              onMarkerClick={setFocusId}
            />
          )}
    </>
  )
}
