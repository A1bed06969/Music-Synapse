'use client'

import dynamic from 'next/dynamic'
import type { GlobePlace, GlobeSpots } from './GlobeExplorer'

// three.js(WebGL)はブラウザでしか動かないため、サーバーでは描かない
const GlobeExplorer = dynamic(() => import('./GlobeExplorer'), {
  ssr: false,
  loading: () => <div className="h-[72vh] min-h-[480px] animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />,
})

export default function GlobeLoader({ places, spots }: { places: GlobePlace[]; spots: GlobeSpots }) {
  return <GlobeExplorer places={places} spots={spots} />
}
