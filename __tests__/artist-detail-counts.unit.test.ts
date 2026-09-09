import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { sumTimelineCounts } from '../utils/artistDetailCounts.ts'

describe('sumTimelineCounts', () => {
  test('6種の件数を合計する', () => {
    const result = sumTimelineCounts({
      releaseCount: 3,
      liveCount: 2,
      festivalCount: 1,
      tieUpCount: 0,
      mediaCount: 5,
      awardCount: 1,
    })
    assert.equal(result, 12)
  })

  test('すべて0なら0', () => {
    const result = sumTimelineCounts({
      releaseCount: 0,
      liveCount: 0,
      festivalCount: 0,
      tieUpCount: 0,
      mediaCount: 0,
      awardCount: 0,
    })
    assert.equal(result, 0)
  })
})
