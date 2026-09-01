import type { ReactNode } from 'react'

/** ジャケットスタックを木箱のクレートの中に置いているように見せる装飾フレーム。
 * 左右の壁を台形(clip-path)で描いてパースを暗示し、奥の背板・手前のリップ、
 * 板の継ぎ目を思わせる横線を重ねる。画像アセットは使わず、すべてCSSグラデー
 * ション+clip-pathで構成している。 */
export default function CrateFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative mx-auto w-64 sm:w-80">
      {/* 奥の背板 */}
      <div
        className="absolute -top-3 left-1/2 h-4 w-[112%] -translate-x-1/2 rounded-t-[2px]"
        style={{ background: 'linear-gradient(180deg, #4a2f1a, #241608)' }}
      />

      {/* 左壁 */}
      <div
        className="absolute -left-9 top-1 bottom-1 w-11"
        style={{
          background: 'linear-gradient(100deg, #40290f 0%, #2a1a0a 60%, #180f06 100%)',
          clipPath: 'polygon(100% 0%, 100% 100%, 0% 100%, 32% 6%)',
        }}
      >
        {[22, 44, 66, 88].map((top) => (
          <div key={top} className="absolute inset-x-0 h-px bg-black/45" style={{ top: `${top}%` }} />
        ))}
        <div className="absolute inset-y-0 right-0 w-3 bg-gradient-to-l from-black/50 to-transparent" />
      </div>

      {/* 右壁(左右対称) */}
      <div
        className="absolute -right-9 top-1 bottom-1 w-11"
        style={{
          background: 'linear-gradient(260deg, #40290f 0%, #2a1a0a 60%, #180f06 100%)',
          clipPath: 'polygon(0% 0%, 0% 100%, 100% 100%, 68% 6%)',
        }}
      >
        {[22, 44, 66, 88].map((top) => (
          <div key={top} className="absolute inset-x-0 h-px bg-black/45" style={{ top: `${top}%` }} />
        ))}
        <div className="absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-black/50 to-transparent" />
      </div>

      {/* 手前のリップ(木口のハイライト付き) */}
      <div
        className="absolute -bottom-5 left-1/2 h-5 w-[110%] -translate-x-1/2 rounded-b-[2px]"
        style={{ background: 'linear-gradient(180deg, #5a3a1e, #241608)', boxShadow: '0 10px 20px rgba(0,0,0,0.55)' }}
      />
      <div className="absolute -bottom-5 left-1/2 h-[2px] w-[110%] -translate-x-1/2 bg-amber-100/20" />

      <div className="relative z-10">{children}</div>
    </div>
  )
}
