// __tests__/use-swipe-gesture.unit.test.ts
//
// Junkie DigのスワイプジェスチャーからSwipeDirectionを決定する純粋関数
// resolveDirectionのテスト。実際のタッチ/マウスイベント配線(useEffect内)は
// ブラウザAPI依存のためユニットテストの対象外とし、80pxしきい値判定と
// 斜め方向ドラッグ時の軸選択ロジックのみを検証する。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { resolveDirection, SWIPE_THRESHOLD_PX } from '../app/components/record-digging/useSwipeGesture.ts'

describe('resolveDirection: threshold boundary', () => {
  test('the threshold constant itself is 80px', () => {
    assert.equal(SWIPE_THRESHOLD_PX, 80)
  })

  test('just under threshold does not fire', () => {
    assert.equal(resolveDirection(SWIPE_THRESHOLD_PX - 1, 0), null)
    assert.equal(resolveDirection(0, SWIPE_THRESHOLD_PX - 1), null)
  })

  test('exactly at threshold fires', () => {
    assert.equal(resolveDirection(SWIPE_THRESHOLD_PX, 0), 'right')
    assert.equal(resolveDirection(0, SWIPE_THRESHOLD_PX), 'down')
  })
})

describe('resolveDirection: cardinal directions', () => {
  test('right', () => assert.equal(resolveDirection(100, 0), 'right'))
  test('left', () => assert.equal(resolveDirection(-100, 0), 'left'))
  test('down', () => assert.equal(resolveDirection(0, 100), 'down'))
  test('up', () => assert.equal(resolveDirection(0, -100), 'up'))
})

describe('resolveDirection: diagonal drags pick the larger-magnitude axis', () => {
  test('horizontal wins when |dx| > |dy|', () => {
    assert.equal(resolveDirection(100, 90), 'right')
    assert.equal(resolveDirection(-100, 90), 'left')
  })

  test('vertical wins when |dy| > |dx|', () => {
    assert.equal(resolveDirection(90, 100), 'down')
    assert.equal(resolveDirection(90, -100), 'up')
  })

  test('an exact tie resolves to the vertical axis (matches current absX > absY comparison)', () => {
    assert.equal(resolveDirection(100, 100), 'down')
    assert.equal(resolveDirection(100, -100), 'up')
  })
})
