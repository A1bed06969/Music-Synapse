'use client'

// ④Music Planet Tour: 左に地球儀、右にエリアごとの代表アーティスト。
// 地球儀はゆっくり自転し、アーティストにカーソルを合わせる(スマホはタップ)と、その出身地へ回って赤いピンを強調する。
import Link from 'next/link'
import { geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects } from 'd3-geo'
import { useEffect, useMemo, useRef, useState } from 'react'
import { artworkAt } from '@/utils/artworkSize'
import type { PlanetArtistCard } from '@/utils/homeCardsMore'
import { PLANET_AREA_LABEL } from '@/utils/planetAreas'

const RED = '#ff3b4f'
const SIZE = 240

type World = { features: { type: 'Feature'; properties: { code: string }; geometry: GeoPermissibleObjects }[] }

// 地図データは画面に出てから1回だけ読み込む(約180KB)
let worldPromise: Promise<World> | null = null
function loadWorld(): Promise<World> {
  worldPromise ??= fetch('/geo/world-compact.json').then((r) => r.json())
  return worldPromise
}

export default function PlanetGlobePanel({ artists, accent }: { artists: PlanetArtistCard[]; accent: string }) {
  const [world, setWorld] = useState<World | null>(null)
  const [rotation, setRotation] = useState<[number, number]>([-140, -20])
  const [active, setActive] = useState<number | null>(null)
  const targetRef = useRef<[number, number] | null>(null)

  useEffect(() => {
    let alive = true
    loadWorld().then((w) => alive && setWorld(w)).catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // 選ばれていなければゆっくり自転。選ばれたら、そのアーティストの出身地が正面に来るまで回す
  useEffect(() => {
    let raf = 0
    const tick = () => {
      setRotation(([lon, lat]) => {
        const t = targetRef.current
        if (!t) return [lon + 0.12, lat + (-20 - lat) * 0.02]
        let dLon = ((t[0] - lon + 540) % 360) - 180
        if (Math.abs(dLon) < 0.05) dLon = 0
        return [lon + dLon * 0.08, lat + (t[1] - lat) * 0.08]
      })
      raf = requestAnimationFrame(tick)
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  function focus(i: number | null) {
    setActive(i)
    targetRef.current = i === null ? null : [-artists[i].lon, -artists[i].lat * 0.7]
  }

  const projection = useMemo(
    () => geoOrthographic().scale(SIZE / 2 - 4).translate([SIZE / 2, SIZE / 2]).rotate(rotation).clipAngle(90),
    [rotation],
  )
  // 座標は小数1桁に丸める(サーバーとブラウザで計算結果の末尾が微妙に違い、表示の食い違いエラーになるため)
  const path = geoPath(projection).digits(1)
  const activeCode = active !== null ? artists[active].countryCode : null
  // 地球の表側(見えている半球)にある出身地だけピンを立てる
  const center = projection.invert?.([SIZE / 2, SIZE / 2])
  const visible = (lon: number, lat: number) => {
    if (!center) return false
    const toRad = Math.PI / 180
    const cos = Math.sin(lat * toRad) * Math.sin(center[1] * toRad) + Math.cos(lat * toRad) * Math.cos(center[1] * toRad) * Math.cos((lon - center[0]) * toRad)
    return cos > 0.05
  }

  return (
    <div className="grid w-full grid-cols-1 items-center gap-4 @sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="mx-auto w-full max-w-64">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-auto w-full" role="img" aria-label="アーティストの出身地を示す地球儀">
          <defs>
            <radialGradient id="planetOcean" cx="0.38" cy="0.35" r="0.75">
              <stop offset="0" stopColor="#16243d" />
              <stop offset="1" stopColor="#070b14" />
            </radialGradient>
            <radialGradient id="planetShade" cx="0.35" cy="0.3" r="0.8">
              <stop offset="0.55" stopColor="#000" stopOpacity="0" />
              <stop offset="1" stopColor="#000" stopOpacity="0.55" />
            </radialGradient>
          </defs>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2 - 1} fill="none" stroke={accent} strokeOpacity="0.35" strokeWidth="2" />
          <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2 - 4} fill="url(#planetOcean)" />
          <path d={path(geoGraticule10()) ?? ''} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="0.6" />
          {world?.features.map((f, i) => (
            <path
              key={i}
              d={path(f.geometry) ?? ''}
              fill={f.properties.code === activeCode ? RED : '#3a4659'}
              fillOpacity={f.properties.code === activeCode ? 0.6 : 1}
              stroke="#0a0f18"
              strokeWidth="0.5"
            />
          ))}
          {artists.map((a, i) => {
            if (!visible(a.lon, a.lat)) return null
            const raw = projection([a.lon, a.lat])
            if (!raw) return null
            const p = [Math.round(raw[0] * 10) / 10, Math.round(raw[1] * 10) / 10]
            const on = active === i
            return (
              <g key={a.id}>
                <circle cx={p[0]} cy={p[1]} r={on ? 11 : 6} fill={RED} opacity={0.25} />
                <circle cx={p[0]} cy={p[1]} r={on ? 4.5 : 3} fill={RED} stroke="#fff" strokeWidth={on ? 1.5 : 1} />
              </g>
            )
          })}
          <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2 - 4} fill="url(#planetShade)" />
        </svg>
      </div>

      <ul className="min-w-0 divide-y divide-white/5" onMouseLeave={() => focus(null)}>
        {artists.map((a, i) => (
          <li key={a.id} onMouseEnter={() => focus(i)} onFocus={() => focus(i)}>
            <Link href={`/artists/${a.id}`} className="group flex items-center gap-2.5 py-1.5">
              <span className="w-[4.5rem] shrink-0 whitespace-nowrap text-[10px] font-bold tracking-wide @sm:text-[11px]" style={{ color: active === i ? accent : 'rgba(255,255,255,0.45)' }}>
                {PLANET_AREA_LABEL[a.area]}
              </span>
              <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-white/5 ring-1 ring-white/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={artworkAt(a.imageUrl, 120) ?? a.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-white group-hover:opacity-80 @sm:text-sm">{a.name}</span>
                <span className="flex items-center gap-1 truncate text-[10px] text-white/45 @sm:text-[11px]">
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: RED }} />
                  <span className="truncate">{a.place}</span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
