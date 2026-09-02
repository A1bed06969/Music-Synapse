'use client'

import { useEffect, useState } from 'react'

// 背景写真(public/images/record-digging/record-box-bg.jpg, 921x1707)はビューポート
// 全面にobject-coverで敷かれている。その中でレコードジャケットが実際に収まる領域を
// 元画像のピクセル座標で定数化したもの(グリッドオーバーレイを重ねて計測)。
const IMAGE_NATURAL_WIDTH = 921
const IMAGE_NATURAL_HEIGHT = 1707
const SLOT_PX = { left: 222, top: 690, width: 476, height: 476 }

export type Rect = { left: number; top: number; width: number; height: number }

function computeSlotRect(viewportWidth: number, viewportHeight: number): Rect {
  // object-coverと同じスケール計算(縦横どちらかがビューポートを覆うまで拡大)
  const scale = Math.max(viewportWidth / IMAGE_NATURAL_WIDTH, viewportHeight / IMAGE_NATURAL_HEIGHT)
  const offsetX = (viewportWidth - IMAGE_NATURAL_WIDTH * scale) / 2
  const offsetY = (viewportHeight - IMAGE_NATURAL_HEIGHT * scale) / 2
  return {
    left: offsetX + SLOT_PX.left * scale,
    top: offsetY + SLOT_PX.top * scale,
    width: SLOT_PX.width * scale,
    height: SLOT_PX.height * scale,
  }
}

/** 背景写真内のスロット位置を、現在のビューポートサイズに対して計算する。
 * 背景画像と同じobject-coverのスケール/オフセット計算をここで再現することで、
 * どのビューポートサイズでも背景内のジャケット置き場に正確に重なる絶対配置
 * 座標(ビューポート基準のpx)を返す。 */
export function useCrateSlotRect(): Rect {
  const [rect, setRect] = useState<Rect>(() => computeSlotRect(window.innerWidth, window.innerHeight))

  useEffect(() => {
    function handleResize() {
      setRect(computeSlotRect(window.innerWidth, window.innerHeight))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return rect
}
