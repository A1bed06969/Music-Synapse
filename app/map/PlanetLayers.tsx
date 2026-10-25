'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import { hubContent } from '@/app/components/hub/hubContents'

/** 地球儀に描くもの(レイヤー)。アーティスト以外は、データがそろい次第ここに足していく */
export type PlanetLayerKey = 'artist' | 'genre' | 'livehouse' | 'shop'
export type PlanetLayer = { key: PlanetLayerKey; label: string; color: string; description: string; count: number | null; ready: boolean }

const LayerContext = createContext<{ layers: PlanetLayer[]; active: PlanetLayerKey; setActive: (k: PlanetLayerKey) => void } | null>(null)

export function PlanetLayerProvider({ layers, children }: { layers: PlanetLayer[]; children: ReactNode }) {
  const [active, setActive] = useState<PlanetLayerKey>('artist')
  return <LayerContext.Provider value={{ layers, active, setActive }}>{children}</LayerContext.Provider>
}

export function usePlanetLayer() {
  const v = useContext(LayerContext)
  return v ?? { layers: [] as PlanetLayer[], active: 'artist' as PlanetLayerKey, setActive: () => {} }
}

/** 右カラム: レイヤーの切り替え */
export function PlanetLayerSwitcher() {
  const { layers, active, setActive } = usePlanetLayer()
  const c = hubContent('planet')
  const current = layers.find((l) => l.key === active)
  return (
    <div>
      <p className="text-[11px] tracking-[0.2em] text-white/40">LAYER</p>
      <ul className="mt-3 grid gap-1">
        {layers.map((l) => {
          const on = l.key === active
          return (
            <li key={l.key}>
              <button
                type="button"
                onClick={() => setActive(l.key)}
                aria-pressed={on}
                className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-bold tracking-wide transition ${on ? 'text-white' : 'text-white/70 hover:bg-white/[0.04] hover:text-white'}`}
                style={on ? { backgroundColor: `${c.color}29`, boxShadow: `inset 3px 0 0 ${c.color}` } : undefined}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: l.color }} />
                {l.label}
                <span className="ml-auto text-xs font-medium text-white/50">{l.ready ? (l.count ?? '') : '準備中'}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {current && <p className="mt-3 text-xs leading-relaxed text-white/50">{current.description}</p>}
    </div>
  )
}
