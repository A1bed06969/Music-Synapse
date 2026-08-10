'use client'

import dynamic from 'next/dynamic'
import type { MapMarker } from './LeafletMap'

const LeafletMap = dynamic(() => import('./LeafletMap'), { ssr: false })

export default function MapClientWrapper({ markers }: { markers: MapMarker[] }) {
  return <LeafletMap markers={markers} />
}
