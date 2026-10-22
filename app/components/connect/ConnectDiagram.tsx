'use client'

import Link from 'next/link'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { artworkAt } from '@/utils/artworkSize'
import { CENTER_CARD, type ConnectEdgeKind, type ConnectLayout } from '@/utils/connectLayout'

/** 線の種類ごとの色と線の形(凡例と同じ) */
export const CONNECT_EDGE_STYLE: Record<ConnectEdgeKind, { label: string; color: string; dash?: string }> = {
  collab: { label: '共演・参加', color: '#56d9ff' },
  related: { label: '制作の関わり', color: '#b6f23a' },
  label: { label: 'レーベル', color: '#8c927f', dash: '2 5' },
}

type Center = { id: string; name: string; image: string | null; sub: string }

/** 角を丸めた折れ線 */
function roundedPath(pts: [number, number][], r = 9): string {
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[i + 1]
    const d1 = Math.hypot(x1 - x0, y1 - y0)
    const d2 = Math.hypot(x2 - x1, y2 - y1)
    if (d1 === 0 || d2 === 0) continue
    const rr = Math.min(r, d1 / 2, d2 / 2)
    d += ` L${x1 - ((x1 - x0) / d1) * rr},${y1 - ((y1 - y0) / d1) * rr} Q${x1},${y1} ${x1 + ((x2 - x1) / d2) * rr},${y1 + ((y2 - y1) / d2) * rr}`
  }
  const last = pts[pts.length - 1]
  return `${d} L${last[0]},${last[1]}`
}

/** ラベルの幅の目安(全角・半角の文字幅から) */
function textWidth(s: string, full: number, half: number): number {
  let w = 0
  for (const ch of s) w += /[\x00-\xff]/.test(ch) ? half : full
  return w
}

function Avatar({ image, name, size, square }: { image: string | null; name: string; size: number; square?: boolean }) {
  const src = artworkAt(image, size * 2)
  const radius = square ? 'rounded-md' : 'rounded-full'
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" className={`${radius} shrink-0 bg-white/5 object-cover`} style={{ width: size, height: size }} />
  }
  return (
    <span className={`${radius} grid shrink-0 place-items-center bg-white/10 font-black text-[#b6f23a]`} style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {name.replace(/^the\s+/i, '').slice(0, 1).toUpperCase()}
    </span>
  )
}

function Legend() {
  return (
    <ul className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-white/60">
      {Object.entries(CONNECT_EDGE_STYLE).map(([k, s]) => (
        <li key={k} className="inline-flex items-center gap-2">
          <svg width="24" height="8" aria-hidden="true">
            <line x1="1" y1="4" x2="23" y2="4" stroke={s.color} strokeWidth="2.4" strokeLinecap="round" strokeDasharray={s.dash ? '2 4' : undefined} />
          </svg>
          {s.label}
        </li>
      ))}
    </ul>
  )
}

function EdgePill({ x, y, lines, color }: { x: number; y: number; lines: string[]; color: string }) {
  const lh = 14
  const w = Math.max(...lines.map((l, i) => (i === 0 ? textWidth(l, 11, 6.6) : textWidth(l, 10, 5.9)))) + 18
  const h = lines.length * lh + 8
  const top = y - h / 2
  return (
    <g>
      <rect x={x - w / 2} y={top} width={w} height={h} rx={9} fill="#121410" stroke={color} strokeWidth={1.2} />
      {lines.map((l, i) => (
        <text key={i} x={x} y={top + 4 + lh * i + 11} textAnchor="middle" fill={i === 0 ? '#eef1e6' : '#9aa18b'} fontSize={i === 0 ? 11 : 10} fontWeight={i === 0 ? 700 : 400}>
          {l}
        </text>
      ))}
    </g>
  )
}

/** 図そのもの(線・ラベル・カード)。等倍の座標で描き、外側で縮める */
function Canvas({ layout, center, markerPrefix, onNavigate }: { layout: ConnectLayout; center: Center; markerPrefix: string; onNavigate?: () => void }) {
  const [hover, setHover] = useState<string | null>(null)
  useEffect(() => setHover(null), [center.id])
  const card = layout.card
  return (
    <div className="relative" style={{ width: layout.width, height: layout.height }}>
      <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} className="absolute inset-0 overflow-visible" aria-hidden="true">
        <defs>
          {Object.entries(CONNECT_EDGE_STYLE).map(([k, s]) => (
            <marker key={k} id={`${markerPrefix}-${k}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={s.color} />
            </marker>
          ))}
        </defs>
        {layout.edges.map((e) => {
          const s = CONNECT_EDGE_STYLE[e.kind]
          const nodeId = e.id.slice(e.id.indexOf('-') + 1)
          const dim = hover !== null && hover !== nodeId
          return (
            <g key={e.id} style={{ opacity: dim ? 0.12 : 1, transition: 'opacity .2s' }}>
              <path
                d={roundedPath(e.points)}
                fill="none"
                stroke={s.color}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={s.dash}
                // 共演の矢印は本人のまわりに集まって読みにくいので付けない(参加・客演はラベルの言葉で分かる)
                markerEnd={e.kind === 'label' && (e.dir === 'out' || e.dir === 'both') ? `url(#${markerPrefix}-${e.kind})` : undefined}
              />
              {e.label && <EdgePill x={e.label.x} y={e.label.y} lines={e.label.lines} color={s.color} />}
            </g>
          )
        })}
      </svg>

      {/* 本人 */}
      <Link
        href={`/artists/${center.id}`}
        prefetch={false}
        onClick={onNavigate}
        className="absolute flex items-center gap-3 rounded-2xl border-2 border-[#b6f23a] bg-[#1a1d14] px-3 shadow-[0_0_0_6px_#b6f23a1f] transition hover:bg-[#20241a]"
        style={{ left: layout.center.x - CENTER_CARD.w / 2, top: layout.center.y - CENTER_CARD.h / 2, width: CENTER_CARD.w, height: CENTER_CARD.h }}
        title="アーティストページを開く"
      >
        <Avatar image={center.image} name={center.name} size={54} />
        <span className="grid min-w-0">
          <span className="truncate text-[15px] font-black leading-tight">{center.name}</span>
          <span className="truncate text-[10.5px] text-white/50">{center.sub || 'プロフィールへ →'}</span>
        </span>
      </Link>

      {/* つながる相手 */}
      {layout.nodes.map((n) => {
        const dim = hover !== null && hover !== n.id
        return (
          <Link
            key={`${n.lane}-${n.id}`}
            href={n.href}
            prefetch={false}
            onClick={onNavigate}
            onMouseEnter={() => setHover(n.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(n.id)}
            onBlur={() => setHover(null)}
            className="absolute flex items-center gap-2 rounded-xl border border-white/10 bg-[#1a1d14] py-1.5 pl-1.5 pr-2 transition hover:border-[#b6f23a]"
            style={{ left: n.x - card.w / 2, top: n.y - card.h / 2, width: card.w, height: card.h, opacity: dim ? 0.25 : 1 }}
            title={n.kind === 'artist' ? `${n.name}の相関図へ` : n.name}
          >
            <Avatar image={n.image} name={n.name} size={38} square={n.kind === 'label'} />
            {n.kind === 'label' ? (
              // レーベル名は長いことが多いので、2行まで出す(「所属」は点線の矢印で分かる)
              <span className="line-clamp-2 min-w-0 text-[12px] font-bold leading-tight">{n.name}</span>
            ) : (
              <span className="grid min-w-0">
                <span className="truncate text-[13px] font-bold leading-tight">{n.name}</span>
                <span className="truncate text-[10.5px] leading-snug text-white/50 tabular-nums">{n.sub}</span>
              </span>
            )}
          </Link>
        )
      })}
    </div>
  )
}

/** 図を縮めて置く(縮めた分だけ外側の余白を詰める) */
function Scaled({ layout, scale, children }: { layout: ConnectLayout; scale: number; children: React.ReactNode }) {
  return (
    <div
      className="origin-top-left"
      style={{ width: layout.width, height: layout.height, transform: `scale(${scale})`, marginRight: layout.width * scale - layout.width, marginBottom: layout.height * scale - layout.height }}
    >
      {children}
    </div>
  )
}

/** 拡大表示: 画面いっぱいのモーダルに、横長のドラマ風の図(全体)を出す */
function WideModal({ layout, center, onClose, markerPrefix }: { layout: ConnectLayout; center: Center; onClose: () => void; markerPrefix: string }) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [box, setBox] = useState({ w: 1200, h: 800 })
  const [mode, setMode] = useState<'fit' | 'full' | null>(null)

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fitScale = Math.min(1, (box.w - 4) / layout.width, (box.h - 18) / layout.height)
  // 画面に合わせると読めないほど小さくなるとき(スマホ)は、等倍で開いて本人を真ん中に見せる
  const effective = mode ?? (fitScale < 0.5 ? 'full' : 'fit')
  const scale = effective === 'fit' ? Math.max(fitScale, 0.3) : 1

  useEffect(() => {
    const el = bodyRef.current
    if (!el || effective !== 'full') return
    el.scrollLeft = layout.center.x - el.clientWidth / 2
    el.scrollTop = Math.max(0, layout.center.y - el.clientHeight / 2)
  }, [effective, layout.center.x, layout.center.y])

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
      prevFocus?.focus()
    }
  }, [onClose])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-wide-title"
      className="fixed inset-0 z-[100] grid grid-rows-[auto_minmax(0,1fr)] bg-[#050605f2] px-4 py-3 backdrop-blur lg:px-8"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-white/10 pb-3">
        <h2 id="connect-wide-title" className="text-lg font-black">
          {center.name}のコネクト<span className="ml-2 text-xs font-medium text-white/50">全体</span>
        </h2>
        <Legend />
        <div className="ml-auto flex items-center gap-3">
          <div className="inline-flex overflow-hidden rounded-full border border-white/15 text-xs" role="group" aria-label="表示の大きさ">
            {(['fit', 'full'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={effective === m}
                className={`px-3 py-1.5 ${effective === m ? 'bg-[#b6f23a] font-bold text-black' : 'text-white/60'}`}
              >
                {m === 'fit' ? '画面に合わせる' : '等倍'}
              </button>
            ))}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="閉じる" className="grid h-9 w-9 place-items-center rounded-full border border-white/20 text-lg hover:border-white/50">
            ×
          </button>
        </div>
      </div>
      <div ref={bodyRef} className={`pt-4 ${effective === 'fit' ? 'overflow-hidden' : 'overflow-auto'}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div style={{ marginLeft: effective === 'fit' ? Math.max(0, (box.w - layout.width * scale) / 2) : 0 }}>
          <Scaled layout={layout} scale={scale}>
            <Canvas layout={layout} center={center} markerPrefix={markerPrefix} onNavigate={onClose} />
          </Scaled>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function ConnectDiagram({
  tree,
  compact,
  wide,
  center,
}: {
  /** 3カラムの中央用(枝の上にラベル) */
  tree: ConnectLayout
  /** 狭い幅(スマホ)用 */
  compact: ConnectLayout
  /** 拡大表示(モーダル)用の横長の図 */
  wide: ConnectLayout
  center: Center
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [boxWidth, setBoxWidth] = useState(600)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  // スマホ用とPC用で同じ図が2つ置かれるので、矢印の定義のIDが重ならないようにする
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setBoxWidth(el.clientWidth - 2)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 別の人の図に切り替わったら、拡大表示を閉じる
  useEffect(() => setOpen(false), [center.id])

  const useTree = boxWidth >= 520
  const layout = useTree ? tree : compact
  const scale = Math.min(1, boxWidth / layout.width)

  return (
    <div className="min-w-0 rounded-2xl border border-white/10" style={{ background: 'radial-gradient(circle at 1px 1px, #ffffff0d 1px, transparent 0) 0 0 / 22px 22px, #121410' }}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/10 px-4 py-3">
        <div className="min-w-0 flex-1">
          <Legend />
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-1.5 text-xs font-bold transition hover:border-[#b6f23a] hover:text-[#b6f23a]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M1 4.5V1h3.5M11 4.5V1H7.5M1 7.5V11h3.5M11 7.5V11H7.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          拡大して全体を見る
        </button>
      </div>
      <div ref={wrapRef} className="overflow-hidden p-px">
        <div style={{ marginLeft: Math.max(0, (boxWidth - layout.width * scale) / 2) }}>
          <Scaled layout={layout} scale={scale}>
            <Canvas layout={layout} center={center} markerPrefix={`c${uid}-${useTree ? 'tree' : 'compact'}`} />
          </Scaled>
        </div>
      </div>
      <p className="border-t border-white/10 px-4 py-2.5 text-xs text-white/40">まわりの人を押すと、その人を中心にした図に切り替わります。中央のカードはアーティストページへ。</p>
      {open && <WideModal layout={wide} center={center} onClose={close} markerPrefix={`c${uid}-wide`} />}
    </div>
  )
}
