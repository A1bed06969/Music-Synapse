import type { ReactNode } from 'react'

// クレート実写(public/images/record-digging/crate-slot.jpg)は元画像を
// 775x755にクロップしたもの(スマホ縦画面対応で上下に背景が足された新しい
// 元画像に合わせて再クロップ)。その中の空きスロット(ジャケットを重ねる部分)
// はx:[150,625] y:[80,555](475x475の正方形)だったため、その比率をここに
// 定数化している。childrenはこのスロットの位置・サイズにぴったり重なるよう
// 絶対配置する。
const CRATE_ASPECT = 775 / 755
const SLOT = { left: 19.35, top: 10.6, width: 61.29, height: 62.91 }

/** ジャケットスタックを木箱のクレートの中に置いているように見せる装飾フレーム。
 * クレート実写を背景に敷き、その空きスロット部分にちょうど重なる位置へ
 * childrenを絶対配置することで「その箱の中に実際に入っている」ように見せる。 */
export default function CrateFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative mx-auto w-[min(33rem,92vw,calc(70vh*1.027))] sm:w-[min(40rem,85vw,calc(70vh*1.027))]"
      style={{ aspectRatio: CRATE_ASPECT }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/record-digging/crate-slot.jpg"
        alt=""
        className="absolute inset-0 h-full w-full rounded-sm object-cover"
        draggable={false}
      />
      <div
        className="absolute z-10"
        style={{ left: `${SLOT.left}%`, top: `${SLOT.top}%`, width: `${SLOT.width}%`, height: `${SLOT.height}%` }}
      >
        {children}
      </div>
    </div>
  )
}
