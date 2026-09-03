'use client'

import { useEffect, useState } from 'react'

// 背景写真(public/images/record-digging/record-box-tag.png)の元画像サイズと、
// その中でレコードジャケットが実際に収まる領域・ジャンル札(タグ)が写っている
// 領域を元画像のピクセル座標で定数化したもの(グリッドオーバーレイを重ねて計測)。
const IMAGE_NATURAL_WIDTH = 921
const IMAGE_NATURAL_HEIGHT = 1707
const SLOT_PX = { left: 222, top: 690, width: 476, height: 476 }
// 札に写っている"NEW ARRIVAL"の文字部分(角丸カードの上端・下端は含まない、
// 文字だけを覆えれば良いため)
const TAG_PX = { left: 300, top: 498, width: 345, height: 52 }

// 背景写真は縦長のスマホ画面向けに用意されたもの。PC等の横長ビューポートで
// object-coverの実スケール(縦横どちらかがビューポートを覆うまで拡大)を
// そのまま使うと、背景が不自然なほどズームされて見え、ジャケットも
// ヘッダーや下部のShelfPickerと重なるほど巨大になってしまう。そのため
// 背景・ジャケット共通のスケールに上限を設け、上限に達した場合は背景を
// ビューポート中央に収める(はみ出す分は周囲がレターボックスになる)。
// ジャケットのスケールも背景と必ず同じにすることで、常に写真内のクレートに
// ぴったり重なる(スマホ縦画面では実スケールが常にこの上限を大きく下回るため、
// この上限は効かず従来どおり画面全面を覆う)。
const MAX_SCALE = 0.85
// ヘッダー/ジャンルタブ(上)・ShelfPicker(下)と重ならないための最低余白。
// 上限スケールでも横長すぎる/縦に低いビューポートでは収まりきらない場合が
// あるため、その時だけジャケット位置をこの範囲に収める(背景とのわずかな
// ズレより、UIとの重なりを避けることを優先する)。
const TOP_RESERVE_PX = 120
const BOTTOM_RESERVE_PX = 190
// スマホ(スケールが上限に達しない=画面全面を覆う通常ケース)では、背景と
// ジャケットを少し上に持ち上げる。下端に空く分は写真自体も暗い床部分の
// ため、コンテナの下地色と馴染んで違和感が出にくい。
const MOBILE_LIFT_RATIO = 0.12

export type Rect = { left: number; top: number; width: number; height: number }
type Layout = { background: Rect; slot: Rect; tag: Rect; viewportHeight: number }

function computeLayout(viewportWidth: number, viewportHeight: number): Layout {
  const naturalScale = Math.max(viewportWidth / IMAGE_NATURAL_WIDTH, viewportHeight / IMAGE_NATURAL_HEIGHT)
  const isCapped = naturalScale > MAX_SCALE
  const scale = Math.min(naturalScale, MAX_SCALE)
  const offsetX = (viewportWidth - IMAGE_NATURAL_WIDTH * scale) / 2
  const offsetY = (viewportHeight - IMAGE_NATURAL_HEIGHT * scale) / 2 - (isCapped ? 0 : viewportHeight * MOBILE_LIFT_RATIO)

  const background: Rect = {
    left: offsetX,
    top: offsetY,
    width: IMAGE_NATURAL_WIDTH * scale,
    height: IMAGE_NATURAL_HEIGHT * scale,
  }

  const slotWidth = SLOT_PX.width * scale
  const slotHeight = SLOT_PX.height * scale
  const naturalSlotTop = offsetY + SLOT_PX.top * scale
  const slotTop = Math.min(
    Math.max(naturalSlotTop, TOP_RESERVE_PX),
    viewportHeight - BOTTOM_RESERVE_PX - slotHeight
  )
  // 札は背景写真に写り込んでいる実物(動かない)なので、ジャケットが安全領域に
  // 収まるよう調整される分のズレ(slotTop - naturalSlotTop)は追従させない。
  // 追従させると、ジャケットが避けるためにずらされた分だけ札のマスクが
  // 背景の実物の札からズレ、下にはみ出た元の文字が二重に見えてしまう。
  const tag: Rect = {
    left: offsetX + TAG_PX.left * scale,
    top: offsetY + TAG_PX.top * scale,
    width: TAG_PX.width * scale,
    height: TAG_PX.height * scale,
  }

  return {
    background,
    slot: { left: offsetX + SLOT_PX.left * scale, top: slotTop, width: slotWidth, height: slotHeight },
    tag,
    viewportHeight,
  }
}

// モバイルブラウザ(特にSafari)はアドレスバーの開閉でwindow.innerHeightが
// 一時的に実際より小さい値を返すことがある。その瞬間にscaleを計算すると
// 縦横比が実際より横長寄りに見え、本来PC等の横長ビューポート向けの
// レターボックス処理(MAX_SCALE)が誤ってスマホ側でも発動し、背景が
// フチまで届かない(右端に隙間ができる)不具合につながる。visualViewportが
// 使える場合はそちらを優先し(アドレスバーの開閉に追従して正確な値を返す)、
// resizeイベントもwindow分だけでなくvisualViewport分も購読する。
function getViewportSize(): { width: number; height: number } {
  const vv = window.visualViewport
  return { width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight }
}

/** 背景写真とその中のジャケット置き場を、現在のビューポートサイズに対して
 * 計算する。両者は常に同じスケールで計算されるため、背景がレターボックス
 * される(=縮小される)場面でもジャケットは背景内の対応位置に正確に重なる。 */
export function useCrateSlotRect(): Layout {
  const [layout, setLayout] = useState(() => {
    const { width, height } = getViewportSize()
    return computeLayout(width, height)
  })

  useEffect(() => {
    function handleResize() {
      const { width, height } = getViewportSize()
      setLayout(computeLayout(width, height))
    }
    window.addEventListener('resize', handleResize)
    window.visualViewport?.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      window.visualViewport?.removeEventListener('resize', handleResize)
    }
  }, [])

  return layout
}
