'use client'

import type { CSSProperties } from 'react'
import type { DiggingRecord } from '@/utils/recordDigging'
import RecordDiggingHand, { type HandGesture } from './RecordDiggingHand'

type Layer = {
  record: DiggingRecord
  role: 'exiting' | 'front' | 'picking' | 'peek'
  depth: number
}

// 奥の1-2枚ははっきり見え、3枚目は気配程度、というムラのある減衰にする
// (均等な1/depthだと2枚目以降がほぼ見えなくなってしまうため)
const PEEK_OPACITY = [0.55, 0.32, 0.15]

/** 中央に現在の1枚、その奥に次・次々…のレコード(upNext、最大3件)をチラ見せする。
 * 完全には見せず、縮小+低opacityで縁だけ覗かせて「棚を掘っている」感を出す。
 *
 * exiting/currentを含め全レイヤーを同じ配列・同じrecord.idキーで1回のmapに
 * まとめて描画しているのが肝で、下スワイプでdeckPositionが進むと「奥にいた
 * 1枚」が同じDOMノードのまま「手前」の位置スタイルへ切り替わり、
 * transition-allでその移動が自動的にアニメーションする(Reactのキー一致に
 * 乗せたFLIPアニメーション)。exiting/picking時だけ専用のkeyframeクラスに
 * 差し替えて「送られる」「つまみ上げられる」動きを出す。 */
export default function RecordSleeve({
  current,
  upNext,
  exiting,
  gesture,
  pulseKey,
}: {
  current: DiggingRecord
  upNext: DiggingRecord[]
  exiting: DiggingRecord | null
  gesture: HandGesture
  pulseKey: number
}) {
  const layers: Layer[] = [
    ...(exiting ? [{ record: exiting, role: 'exiting', depth: 0 } satisfies Layer] : []),
    { record: current, role: gesture === 'picking' ? 'picking' : 'front', depth: 0 } satisfies Layer,
    ...upNext.map((record, i) => ({ record, role: 'peek', depth: i + 1 }) satisfies Layer),
  ]

  return (
    <div className="relative mx-auto aspect-square w-64 sm:w-80">
      {layers
        .slice()
        .reverse()
        .map(({ record, role, depth }) => {
          const isFront = role === 'front'
          const style: CSSProperties =
            role === 'peek'
              ? {
                  top: `${depth * 12}px`,
                  bottom: `${-depth * 12}px`,
                  transform: `scale(${1 - depth * 0.055})`,
                  opacity: PEEK_OPACITY[depth - 1] ?? 0.1,
                  zIndex: 10 - depth,
                }
              : {
                  top: 0,
                  bottom: 0,
                  transform: 'scale(1)',
                  opacity: 1,
                  zIndex: role === 'exiting' ? 30 : 20,
                }

          const animationClass =
            role === 'exiting'
              ? 'animate-record-send-away'
              : role === 'picking'
                ? 'animate-record-lift'
                : 'transition-all duration-300 ease-out'

          return (
            <div
              key={record.id}
              className={`absolute inset-x-0 overflow-hidden rounded-lg bg-white/5 shadow-2xl shadow-black/70 ${role === 'front' || role === 'picking' ? 'ring-1 ring-white/10' : ''} ${animationClass}`}
              style={style}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={record.jacketUrl}
                alt={isFront ? record.title : ''}
                className={`h-full w-full ${isFront ? 'object-contain' : 'object-cover'}`}
                draggable={false}
              />
              {isFront && !record.firstTrackPreviewUrl && (
                <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] text-white/60 backdrop-blur">
                  配信情報なし
                </span>
              )}
            </div>
          )
        })}

      <div
        key={gesture === 'sending' ? `sending-${pulseKey}` : gesture}
        className={`pointer-events-none absolute -left-6 -top-5 z-40 w-24 ${gesture === 'sending' ? 'animate-hand-send' : ''} ${gesture === 'picking' ? 'animate-hand-pick' : ''}`}
      >
        <RecordDiggingHand />
      </div>
    </div>
  )
}
