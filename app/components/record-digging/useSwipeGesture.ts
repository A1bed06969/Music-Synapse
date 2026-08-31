'use client'

import { useEffect, useRef } from 'react'

export type SwipeDirection = 'up' | 'down' | 'left' | 'right'

export const SWIPE_THRESHOLD_PX = 80

export function resolveDirection(dx: number, dy: number): SwipeDirection | null {
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)
  if (Math.max(absX, absY) < SWIPE_THRESHOLD_PX) return null
  if (absX > absY) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'down' : 'up'
}

/** タッチ/マウスドラッグ/矢印キーを統一的にスワイプ方向イベントへ変換する。
 * 返されたrefを対象要素に付けると、その要素上でのタッチ・マウス操作を検知する
 * (矢印キーはdocument全体で検知する)。1ジェスチャーにつきonSwipeは最大1回だけ発火する。 */
export function useSwipeGesture(onSwipe: (direction: SwipeDirection) => void) {
  const ref = useRef<HTMLDivElement>(null)
  const onSwipeRef = useRef(onSwipe)
  onSwipeRef.current = onSwipe

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let startX = 0
    let startY = 0
    let tracking = false
    let fired = false

    function handleMove(clientX: number, clientY: number) {
      if (!tracking || fired) return
      const direction = resolveDirection(clientX - startX, clientY - startY)
      if (direction) {
        fired = true
        tracking = false
        onSwipeRef.current(direction)
      }
    }

    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0]
      startX = t.clientX
      startY = t.clientY
      tracking = true
      fired = false
    }
    function onTouchMove(e: TouchEvent) {
      const t = e.touches[0]
      handleMove(t.clientX, t.clientY)
    }
    function onTouchEnd() {
      tracking = false
    }

    function onMouseDown(e: MouseEvent) {
      startX = e.clientX
      startY = e.clientY
      tracking = true
      fired = false
    }
    function onMouseMove(e: MouseEvent) {
      handleMove(e.clientX, e.clientY)
    }
    function onMouseUp() {
      tracking = false
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat) return
      if (e.key === 'ArrowUp') onSwipeRef.current('up')
      else if (e.key === 'ArrowDown') onSwipeRef.current('down')
      else if (e.key === 'ArrowLeft') onSwipeRef.current('left')
      else if (e.key === 'ArrowRight') onSwipeRef.current('right')
      else return
      e.preventDefault()
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return ref
}
