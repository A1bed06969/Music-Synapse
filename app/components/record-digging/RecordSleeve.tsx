'use client'

import type { DiggingRecord } from '@/utils/recordDigging'

/** 中央に現在の1枚、その奥に次・次々のレコード(upNext、最大2件)をチラ見せする。
 * 完全には見せず、縮小+低opacityで縁だけ覗かせて「棚を掘っている」感を出す。 */
export default function RecordSleeve({
  current,
  upNext,
}: {
  current: DiggingRecord
  upNext: DiggingRecord[]
}) {
  return (
    <div className="relative mx-auto aspect-square w-64 sm:w-80">
      {upNext
        .slice()
        .reverse()
        .map((rec, i) => {
          const depth = upNext.length - i
          return (
            <div
              key={rec.id}
              className="absolute inset-x-0 overflow-hidden rounded-lg bg-white/5"
              style={{
                top: `${depth * 10}px`,
                bottom: `${-depth * 10}px`,
                transform: `scale(${1 - depth * 0.05})`,
                opacity: 0.25 / depth,
                zIndex: 10 - depth,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={rec.jacketUrl} alt="" className="h-full w-full object-cover" />
            </div>
          )
        })}

      <div className="relative z-10 aspect-square overflow-hidden rounded-lg bg-white/5 shadow-2xl shadow-black/70 ring-1 ring-white/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.jacketUrl} alt={current.title} className="h-full w-full object-contain" />
        {!current.firstTrackPreviewUrl && (
          <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] text-white/60 backdrop-blur">
            配信情報なし
          </span>
        )}
      </div>
    </div>
  )
}
