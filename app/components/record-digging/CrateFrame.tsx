import type { ReactNode } from 'react'
import type { Rect } from './useCrateSlotRect'

/** ジャケットスタックを、モーダル背景写真(record-box-bg.jpg)に写っている
 * クレートの空きスロット位置にちょうど重なるよう絶対配置する装飾フレーム。
 * 位置(rect)はuseCrateSlotRectで計算したビューポート基準のpx。 */
export default function CrateFrame({
  rect,
  className,
  children,
}: {
  rect: Rect
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={`fixed z-10 ${className ?? ''}`}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      {children}
    </div>
  )
}
