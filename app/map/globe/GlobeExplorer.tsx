'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GlobeInstance } from 'globe.gl'
import { usePlanetLayer } from '../PlanetLayers'

export type GlobePlace = { id: string; label: string; country: string; countryCode: string; lat: number; lng: number; count: number }
type Preview = { id: string; label: string; name: string; country: string; total: number; artists: { id: string; name: string; imageUrl: string | null; firstYear: number | null }[] }

const ACCENT = '#a27bff'
// ラベルを常に出す、出身アーティストの多い都市の数
const LABELED = 14
type Band = 'far' | 'mid' | 'near'

/** Music Planet Tour の地球儀: 都市を光の柱(高さ=出身アーティスト数)で立て、回して・寄って・タップで街のカードを開く */
export default function GlobeExplorer({ places }: { places: GlobePlace[] }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const globeRef = useRef<GlobeInstance | null>(null)
  const [selected, setSelected] = useState<GlobePlace | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
  const pendingRef = useRef<string | null>(null)
  const [showAttribution, setShowAttribution] = useState(false)
  // 右カラムで選んだレイヤー。いまはアーティストだけが描ける(ほかは準備中)
  const { layers, active, setActive } = usePlanetLayer()
  const activeLayer = layers.find((l) => l.key === active)
  const showArtists = active === 'artist'
  const showArtistsRef = useRef(showArtists)

  const flyTo = useCallback((p: GlobePlace) => {
    const g = globeRef.current
    if (!g) return
    g.controls().autoRotate = false
    // 今の倍率のまま、その街へ回り込む(遠くから見ているときだけ、少し寄る)。
    // カードが下に出るので、都市が画面の上寄りに来るよう、倍率に応じて少し南を向く
    const altitude = Math.min(g.pointOfView().altitude, 1.8)
    g.pointOfView({ lat: p.lat - altitude * 7, lng: p.lng, altitude }, 1200)
    g.ringsData([p])
    setSelected(p)
    // カードの中身(代表アーティスト)を読む。続けて別の都市を選んだら、古い結果は捨てる
    setPreview(null)
    setLoading(true)
    pendingRef.current = p.id
    fetch(`/api/places/${p.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Preview | null) => {
        if (pendingRef.current === p.id) setPreview(d)
      })
      .finally(() => {
        if (pendingRef.current === p.id) setLoading(false)
      })
  }, [])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    let disposed = false
    let ro: ResizeObserver | null = null
    let io: IntersectionObserver | null = null
    let zoomTimer: ReturnType<typeof setTimeout> | null = null
    let lastZoomCheck = 0
    let labelKey = ''
    ;(async () => {
      const { default: Globe } = await import('globe.gl')
      if (disposed) return
      const max = Math.max(...places.map((p) => p.count), 1)
      const ratio = (p: GlobePlace) => Math.sqrt(p.count / max)
      // 寄り具合で見せ方を3段階に切り替える。遠い: 点々の地球+光の柱 / 中・近い: 暗い地図+低い印+街の名前
      let band: Band = 'far'
      const style = {
        far: { height: 0.32, base: 0.015, radius: 0.5, minRadius: 0.2 },
        mid: { height: 0.04, base: 0.004, radius: 0.4, minRadius: 0.12 },
        near: { height: 0.012, base: 0.0015, radius: 0.1, minRadius: 0.035 },
      }
      const heightOf = (p: GlobePlace) => style[band].base + style[band].height * ratio(p)
      const labelEl = (p: GlobePlace, withCount: boolean) => {
        const tag = document.createElement('button')
        tag.type = 'button'
        tag.innerHTML = withCount ? `${p.label}<span style="opacity:.6;margin-left:4px">${p.count}</span>` : p.label
        tag.style.cssText =
          'pointer-events:auto;cursor:pointer;transform:translate(-50%,-140%);padding:2px 7px;border-radius:999px;border:1px solid rgba(162,123,255,.6);background:rgba(11,11,16,.8);color:#efeaff;font:700 11px "Noto Sans JP",sans-serif;white-space:nowrap;will-change:transform'
        tag.onclick = () => flyTo(p)
        return tag
      }
      // 今見えている範囲の街(中心からの角度で近似)を、人数の多い順に。名札どうしが重ならないよう、近すぎる街は間引く
      const visiblePlaces = (limit: number) => {
        const pov = g.pointOfView()
        const reach = Math.min(70, Math.max(3, pov.altitude * 55))
        const gap = pov.altitude * 4.5
        const dist = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
          let dl = Math.abs(a.lng - b.lng)
          if (dl > 180) dl = 360 - dl
          return Math.hypot(a.lat - b.lat, dl * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180))
        }
        const picked: GlobePlace[] = []
        for (const p of places) {
          if (picked.length >= limit) break
          if (dist(p, pov) > reach) continue
          if (picked.some((q) => dist(p, q) < gap)) continue
          picked.push(p)
        }
        return picked
      }
      // 柱を直接タップできるよう、選べる範囲(度)の中で一番近い都市を探す。柱は1つの形にまとめて描くため、柱ごとのクリックは使えない
      const nearest = (lat: number, lng: number): GlobePlace | null => {
        const alt = g.pointOfView().altitude
        const limit = Math.max(0.15, alt * 2.2)
        let best: GlobePlace | null = null
        let bestD = Infinity
        const cos = Math.cos((lat * Math.PI) / 180)
        for (const p of places) {
          let dl = Math.abs(p.lng - lng)
          if (dl > 180) dl = 360 - dl
          const d = Math.hypot(p.lat - lat, dl * cos)
          // 遠くから見ているときは、人数の多い街を少しだけ優先する
          const score = d - (band === 'far' ? 0.15 : 0.01) * Math.sqrt(p.count)
          if (d < limit && score < bestD) {
            bestD = score
            best = p
          }
        }
        return best
      }
      const g = new Globe(el, { animateIn: true, rendererConfig: { antialias: false, powerPreference: 'high-performance' } })
        .backgroundColor('rgba(0,0,0,0)')
        // 陸地の点々は、あらかじめ1枚の画像に焼き付けたもの(毎フレーム何万個も描かないため)
        .globeImageUrl('/geo/globe-dots.png')
        .showAtmosphere(true)
        .atmosphereColor(ACCENT)
        .atmosphereAltitude(0.18)
        // 都市 = 光の柱。高さは人数の平方根で(ロンドンだけが突き抜けないように)。全部を1つの形にまとめて描く
        .pointsData(places)
        .pointLat('lat')
        .pointLng('lng')
        .pointAltitude((d) => heightOf(d as GlobePlace))
        .pointRadius((d) => style[band].minRadius + style[band].radius * ratio(d as GlobePlace))
        .pointColor((d) => ((d as GlobePlace).count >= 10 ? '#d9c8ff' : ACCENT))
        .pointResolution(6)
        .pointsMerge(true)
        .pointsTransitionDuration(0)
        .onGlobeClick(({ lat, lng }) => {
          if (!showArtistsRef.current) return
          const p = nearest(lat, lng)
          if (p) flyTo(p)
        })
        // 選んだ都市に広がる輪
        .ringColor(() => (t: number) => `rgba(162,123,255,${1 - t})`)
        .ringMaxRadius(4)
        .ringPropagationSpeed(2.5)
        .ringRepeatPeriod(900)
        // 街の名前(日本語を出すため、HTMLで重ねる)。遠いときは大都市だけ、寄ったら見えている範囲の街を人数つきで
        .htmlElementsData(places.slice(0, LABELED))
        .htmlLat('lat')
        .htmlLng('lng')
        .htmlAltitude((d) => heightOf(d as GlobePlace) + 0.003)
        .htmlTransitionDuration(0)
        .htmlElement((d) => labelEl(d as GlobePlace, band !== 'far'))
        .onZoom(() => {
          // 回している間(自転中も)は毎フレーム呼ばれるので、0.25秒に1回だけ見直す
          const now = performance.now()
          if (now - lastZoomCheck < 250) {
            if (!zoomTimer) zoomTimer = setTimeout(applyZoom, 260)
            return
          }
          applyZoom()
        })
      function applyZoom() {
        zoomTimer = null
        lastZoomCheck = performance.now()
        const alt = g.pointOfView().altitude
        const next: Band = alt > 1.4 ? 'far' : alt > 0.3 ? 'mid' : 'near'
        if (next !== band) {
          band = next
          // 寄ったら、国境や地名の見える暗い地図(タイル)を地球に貼る
          g.globeTileEngineUrl(band === 'far' ? null! : (x, y, l) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${l}/${y}/${x}`)
          g.pointAltitude(g.pointAltitude()).pointRadius(g.pointRadius())
          setShowAttribution(band !== 'far')
        }
        // 街の名前: 遠いときは大都市だけ、寄ったら見えている範囲の街を人数つきで
        const labels = !showArtistsRef.current ? [] : band === 'far' ? places.slice(0, LABELED) : visiblePlaces(band === 'near' ? 40 : 24)
        const key = band + labels.map((p) => p.id).join(',')
        if (key !== labelKey) {
          labelKey = key
          // 段階が変わったら名札を作り直す(同じ街のデータだと、前の段階の名札が使い回されるため)
          g.htmlElementsData(labels.map((p) => ({ ...p, band })))
        }
      }
      g.globeTileEngineMaxLevel(12)
      // 高精細な画面でも、描く画素数を抑える(スマホの発熱・カクつき対策)
      g.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
      g.controls().enableDamping = true
      g.controls().dampingFactor = 0.08
      // 画面の外にあるときは描くのを止める
      io = new IntersectionObserver(([entry]) => (entry.isIntersecting ? g.resumeAnimation() : g.pauseAnimation()))
      io.observe(el)
      g.controls().autoRotate = true
      g.controls().autoRotateSpeed = 0.45
      // 触ったら(回す・寄る・引く)自転を止める。勝手に回り続けると、見たい場所が流れていってしまうため
      g.controls().addEventListener('start', () => {
        g.controls().autoRotate = false
      })
      g.pointOfView({ lat: 30, lng: 40, altitude: 2.3 })
      globeRef.current = g
      const resize = () => g.width(el.clientWidth).height(el.clientHeight)
      resize()
      ro = new ResizeObserver(resize)
      ro.observe(el)
    })()
    return () => {
      disposed = true
      if (zoomTimer) clearTimeout(zoomTimer)
      ro?.disconnect()
      io?.disconnect()
      globeRef.current?._destructor?.()
      globeRef.current = null
      el.innerHTML = ''
    }
  }, [places, flyTo])

  // レイヤーを切り替えたら、描くもの(柱と名札)を入れ替える
  useEffect(() => {
    showArtistsRef.current = showArtists
    const g = globeRef.current
    if (!g) return
    g.pointsData(showArtists ? places : [])
    g.htmlElementsData(showArtists ? places.slice(0, LABELED) : [])
  }, [showArtists, places])

  // どこかへ旅する: 国を無作為に選んでから、その国の都市へ(大都市ばかりにならないように)
  const travel = () => {
    // 旅はアーティストの出身地をめぐるので、ほかのレイヤーを見ていたらアーティストに戻す
    if (!showArtists) setActive('artist')
    const byCountry = new Map<string, GlobePlace[]>()
    for (const p of places) byCountry.set(p.countryCode, [...(byCountry.get(p.countryCode) ?? []), p])
    const lists = [...byCountry.values()]
    const list = lists[Math.floor(Math.random() * lists.length)]
    flyTo(list[Math.floor(Math.random() * list.length)])
  }

  const close = () => {
    pendingRef.current = null
    setSelected(null)
    setPreview(null)
    globeRef.current?.ringsData([])
    // 閉じても倍率は変えず、自転も止めたまま(見ていた場所から動かさない)
  }

  return (
    <div className="relative h-[72vh] min-h-[480px] overflow-hidden rounded-2xl border border-white/10" style={{ background: 'radial-gradient(circle at 50% 45%, #1b1533 0%, #0b0b10 62%)' }}>
      {/* 地球儀(と街の名札の層)は、この中に閉じ込めて、上に重ねるカードやボタンより下に描く */}
      <div ref={wrapRef} className="absolute inset-0 isolate z-0" />
      {showAttribution && (
        <p className="pointer-events-none absolute bottom-1 left-2 text-[9px] text-white/40">地図: Esri, HERE, Garmin, © OpenStreetMap contributors</p>
      )}

      {/* 見出し・操作の説明と「どこかへ旅する」を横に並べ、狭い画面では説明が折り返す(重ならないように) */}
      <div className="pointer-events-none absolute inset-x-4 top-4 z-20 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold tracking-[0.2em]" style={{ color: ACCENT }}>
            ARTIST ORIGINS
          </p>
          <p className="mt-1 text-xs leading-relaxed text-white/60 [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">ドラッグで回す ・ ピンチで寄る ・ 光の柱をタップで街へ</p>
        </div>
        <button
          type="button"
          onClick={travel}
          className="pointer-events-auto inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-black text-[#0b0b10] shadow-lg transition hover:brightness-110"
          style={{ background: ACCENT }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M15.5 8.5l-2 5-5 2 2-5z" />
          </svg>
          どこかへ旅する
        </button>
      </div>

      {!showArtists && activeLayer && (
        <div className="pointer-events-none absolute inset-x-6 top-1/2 z-20 -translate-y-1/2 rounded-2xl border border-white/15 bg-[#121018]/90 p-5 text-center backdrop-blur">
          <p className="text-sm font-black">{activeLayer.label}のプロットは準備中です</p>
          <p className="mt-1.5 text-xs leading-relaxed text-white/55">{activeLayer.description}</p>
        </div>
      )}

      {selected && showArtists && (
        <div className="absolute inset-x-3 bottom-3 z-30 rounded-2xl border border-white/15 bg-[#121018]/95 p-4 shadow-2xl backdrop-blur sm:left-auto sm:right-4 sm:w-[380px]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] text-white/50">{selected.country}</p>
              <p className="truncate text-2xl font-black">{selected.label}</p>
              <p className="text-xs text-white/60">
                <span className="text-lg font-black" style={{ color: ACCENT }}>
                  {preview?.total ?? selected.count}
                </span>{' '}
                組がこの街の出身
              </p>
            </div>
            <button type="button" onClick={close} aria-label="閉じる" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/15 text-white/70 hover:bg-white/10">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <ul className="mt-3 flex min-h-[92px] gap-3 overflow-x-auto pb-1">
            {loading && !preview
              ? Array.from({ length: 5 }).map((_, i) => (
                  <li key={i} className="h-[60px] w-[60px] shrink-0 animate-pulse rounded-full bg-white/10" />
                ))
              : preview?.artists.map((a) => (
                  <li key={a.id} className="w-[66px] shrink-0">
                    <Link href={`/artists/${a.id}`} className="flex flex-col items-center gap-1 text-center">
                      {a.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.imageUrl} alt="" className="h-[60px] w-[60px] rounded-full bg-white/5 object-cover ring-1 ring-white/15" />
                      ) : (
                        <span className="grid h-[60px] w-[60px] place-items-center rounded-full bg-white/10 font-black text-white/40">{a.name.slice(0, 1)}</span>
                      )}
                      <span className="line-clamp-2 text-[10px] font-bold leading-tight">{a.name}</span>
                    </Link>
                  </li>
                ))}
          </ul>
          <Link
            href={`/map/places/${selected.id}`}
            className="mt-3 flex h-11 items-center justify-center rounded-xl border text-sm font-bold"
            style={{ borderColor: ACCENT, color: '#e4def7' }}
          >
            この街をもっと見る →
          </Link>
        </div>
      )}
    </div>
  )
}
