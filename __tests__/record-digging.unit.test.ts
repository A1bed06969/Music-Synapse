// __tests__/record-digging.unit.test.ts
//
// Junkie Dig(レコード屋ディグり体験)の棚判定ロジックのうち、TypeScript側で
// 検証可能な部分のテスト。ジャンルの「アルバム数>=閾値」判定そのものはSQL側の
// RPC(record_digging_eligible_genres)で行われるため、ここでは (1) 新着棚の
// JST日付境界計算が正しいか、(2) 棚判定に使われる閾値定数が正しい値のまま
// RPCへ渡されているか、を検証する。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_SHELF_ALBUMS,
  NEW_ARRIVALS_DAYS,
  NEW_ARRIVALS_KEY,
  NEW_ARRIVALS_LABEL,
  daysAgoJST,
  todayJST,
  fetchEligibleGenreShelves,
} from '../utils/recordDigging.ts'

describe('threshold and window constants', () => {
  test('MIN_SHELF_ALBUMS is 8 (the spec-mandated shelf-eligibility threshold)', () => {
    assert.equal(MIN_SHELF_ALBUMS, 8)
  })

  test('NEW_ARRIVALS_DAYS is 30', () => {
    assert.equal(NEW_ARRIVALS_DAYS, 30)
  })
})

describe('daysAgoJST / todayJST', () => {
  test('todayJST returns an ISO date string (YYYY-MM-DD)', () => {
    assert.match(todayJST(), /^\d{4}-\d{2}-\d{2}$/)
  })

  test('daysAgoJST(0) equals todayJST()', () => {
    assert.equal(daysAgoJST(0), todayJST())
  })

  test('daysAgoJST(NEW_ARRIVALS_DAYS) is exactly 30 calendar days before today', () => {
    const today = new Date(todayJST() + 'T00:00:00Z')
    const thirtyAgo = new Date(daysAgoJST(NEW_ARRIVALS_DAYS) + 'T00:00:00Z')
    const diffDays = (today.getTime() - thirtyAgo.getTime()) / (1000 * 60 * 60 * 24)
    assert.equal(diffDays, NEW_ARRIVALS_DAYS)
  })

  test('daysAgoJST is monotonic (more days ago is an earlier or equal date)', () => {
    assert.ok(daysAgoJST(31) <= daysAgoJST(30))
  })
})

describe('fetchEligibleGenreShelves', () => {
  test('passes MIN_SHELF_ALBUMS as min_albums to the RPC, and prepends the 新着 shelf', async () => {
    let capturedFn = ''
    let capturedArgs: unknown = null
    const fakeSupabase = {
      rpc(fn: string, args: unknown) {
        capturedFn = fn
        capturedArgs = args
        return Promise.resolve({
          data: [{ genre_id: 'g1', genre_name: 'Techno' }],
          error: null,
        })
      },
    }

    const shelves = await fetchEligibleGenreShelves(fakeSupabase as any)

    assert.equal(capturedFn, 'record_digging_eligible_genres')
    assert.deepEqual(capturedArgs, { min_albums: MIN_SHELF_ALBUMS })
    assert.deepEqual(shelves[0], { key: NEW_ARRIVALS_KEY, label: NEW_ARRIVALS_LABEL, isGenre: false })
    assert.deepEqual(shelves[1], { key: 'g1', label: 'Techno', isGenre: true })
  })

  test('falls back to just the 新着 shelf when the RPC errors', async () => {
    const fakeSupabase = {
      rpc() {
        return Promise.resolve({ data: null, error: { message: 'boom' } })
      },
    }

    const shelves = await fetchEligibleGenreShelves(fakeSupabase as any)

    assert.deepEqual(shelves, [{ key: NEW_ARRIVALS_KEY, label: NEW_ARRIVALS_LABEL, isGenre: false }])
  })
})
