'use client'

import { useEffect, useState } from 'react'

// 背景写真(public/images/record-digging/record-box-bg.jpg, 921x1707)はビューポート
// 全面にobject-coverで敷かれている。その中でレコードジャケットが実際に収まる領域を
// 元画像のピクセル座標で定数化したもの(グリッドオーバーレイを重ねて計測)。
const IMAGE_NATURAL_WIDTH = 921
const IMAGE_NATURAL_HEIGHT = 1707
const SLOT_PX = { left: 222, top: 690, width: 476, height: 476 }

// 背景写真は縦長のスマホ画面向けに用意されたもの。PC等の横長ビューポートで
// そのままobject-coverのスケールを使うと(縦を覆うために)極端に拡大され、
// ジャケットがヘッダーや下部のShelfPickerと重なるほど巨大になってしまう。
// そのためスロットの拡大率には上限を設け、上限に達した場合は「本来この
// スケールなら中心が来るはずだった座標」を軸に縮小する(スマホ縦画面では
// 実スケールが常にこの上限を大きく下回るため、この上限は効かず従来どおり
// 背景と正確に重なる)。
const MAX_SLOT_SCALE = 0.75
// ヘッダー/ジャンルタブ(上)・ShelfPicker(下)と重ならないための最低余白
const TOP_RESERVE_PX = 120
const BOTTOM_RESERVE_PX = 190

export type Rect = { left: number; top: number; width: number; height: number }

function computeSlotRect(viewportWidth: number, viewportHeight: number): Rect {
  // object-coverと同じスケール計算(縦横どちらかがビューポートを覆うまで拡大)
  const naturalScale = Math.max(viewportWidth / IMAGE_NATURAL_WIDTH, viewportHeight / IMAGE_NATURAL_HEIGHT)
  const offsetX = (viewportWidth - IMAGE_NATURAL_WIDTH * naturalScale) / 2
  const offsetY = (viewportHeight - IMAGE_NATURAL_HEIGHT * naturalScale) / 2
  const centerX = offsetX + (SLOT_PX.left + SLOT_PX.width / 2) * naturalScale
  const centerY = offsetY + (SLOT_PX.top + SLOT_PX.height / 2) * naturalScale

  const scale = Math.min(naturalScale, MAX_SLOT_SCALE)
  const width = SLOT_PX.width * scale
  const height = SLOT_PX.height * scale

  const top = Math.min(Math.max(centerY - height / 2, TOP_RESERVE_PX), viewportHeight - BOTTOM_RESERVE_PX - height)

  return {
    left: centerX - width / 2,
    top,
    width,
    height,
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
