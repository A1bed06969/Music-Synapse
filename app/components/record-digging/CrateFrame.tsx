import type { ReactNode } from 'react'

// クレート実写(public/images/record-digging/crate-slot.jpg)は元画像を
// 1115x1005にクロップしたもの。その中の空きスロット(ジャケットを重ねる部分)
// はx:[230,885] y:[100,755](655x655の正方形)だったため、その比率をここに
// 定数化している。childrenはこのスロットの位置・サイズにぴったり重なるよう
// 絶対配置する。
const CRATE_ASPECT = 1115 / 1005
const SLOT = { left: 20.63, top: 9.95, width: 58.74, height: 65.17 }

/** ジャケットスタックを木箱のクレートの中に置いているように見せる装飾フレーム。
 * クレート実写を背景に敷き、その空きスロット部分にちょうど重なる位置へ
 * childrenを絶対配置することで「その箱の中に実際に入っている」ように見せる。 */
export default function CrateFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative mx-auto w-[min(33rem,92vw,calc(70vh*1.109))] sm:w-[min(40rem,85vw,calc(70vh*1.109))]"
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
