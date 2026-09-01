'use client'

import type { CSSProperties } from 'react'
import type { DiggingRecord } from '@/utils/recordDigging'
import RecordDiggingHand, { type HandGesture } from './RecordDiggingHand'
import type { DragState } from './useSwipeGesture'

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
 * transition-layerでその移動が自動的にアニメーションする(Reactのキー一致に
 * 乗せたFLIPアニメーション)。exiting/picking時だけ専用のkeyframeクラスに
 * 差し替えて「送られる」「つまみ上げられる」動きを出す。
 *
 * dragStateは、しきい値に達する前のドラッグ量。手前(front)のレイヤーだけに
 * リアルタイムで反映し、指でレコードを押しているような追従を作る。ドラッグ中は
 * transition-noneで遅延なく追従させ、離した瞬間(dragging:falseに戻る)だけ
 * transition-springでスプリングバックさせる。 */
export default function RecordSleeve({
  current,
  upNext,
  exiting,
  gesture,
  pulseKey,
  dragState,
}: {
  current: DiggingRecord
  upNext: DiggingRecord[]
  exiting: DiggingRecord | null
  gesture: HandGesture
  pulseKey: number
  dragState: DragState
}) {
  const layers: Layer[] = [
    ...(exiting ? [{ record: exiting, role: 'exiting', depth: 0 } satisfies Layer] : []),
    { record: current, role: gesture === 'picking' ? 'picking' : 'front', depth: 0 } satisfies Layer,
    ...upNext.map((record, i) => ({ record, role: 'peek', depth: i + 1 }) satisfies Layer),
  ]

  return (
    <div className="relative h-full w-full">
      {layers
        .slice()
        .reverse()
        .map(({ record, role, depth }) => {
          const isFront = role === 'front'
          const dragTransform = isFront
            ? `translate(${dragState.dx}px, ${dragState.dy}px) rotate(${(dragState.dx * 0.04).toFixed(2)}deg)`
            : 'scale(1)'

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
                  transform: isFront ? dragTransform : 'scale(1)',
                  opacity: 1,
                  zIndex: role === 'exiting' ? 30 : 20,
                }

          const animationClass =
            role === 'exiting'
              ? 'animate-record-send-away'
              : role === 'picking'
                ? 'animate-record-lift'
                : isFront
                  ? dragState.dragging
                    ? 'transition-none'
                    : 'transition-spring'
                  : 'transition-layer'

          return (
            <div
              key={record.id}
              className={`absolute inset-x-0 overflow-hidden rounded-[3px] bg-white/5 shadow-2xl shadow-black/80 ${role === 'front' || role === 'picking' ? 'ring-1 ring-black/40' : ''} ${animationClass}`}
              style={style}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={record.jacketUrl}
                alt={isFront ? record.title : ''}
                className={`h-full w-full ${isFront ? 'object-contain' : 'object-cover'}`}
                draggable={false}
              />
              {/* ビニール袋の反射を思わせる、斜めに走る薄いハイライト */}
              {(role === 'front' || role === 'picking') && (
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      'linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.10) 46%, rgba(255,255,255,0.03) 52%, transparent 68%)',
                  }}
                />
              )}
              {isFront && !record.firstTrackPreviewUrl && (
                <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] text-white/60 backdrop-blur">
                  配信情報なし
                </span>
              )}
            </div>
          )
        })}

      {/* 手: ジャケットの手前(z-40)に1枚で表示し、右端をつまんで持ち上げている
       * ように見せる。left/topはジャケット右端寄り・縦方向はやや上寄りの位置。 */}
      <div
        key={gesture === 'sending' ? `sending-${pulseKey}` : gesture}
        className={`pointer-events-none absolute left-[73%] top-[3%] z-40 w-[53%] ${gesture === 'sending' ? 'animate-hand-send' : ''} ${gesture === 'picking' ? 'animate-hand-pick' : ''}`}
      >
        <RecordDiggingHand />
      </div>
    </div>
  )
}
