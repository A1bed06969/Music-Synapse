// __tests__/featuring-billing-order.unit.test.ts
//
// トラックタイトルから"(feat. A, B)"/"[feat. A, B]"を抽出し、グループ内の
// アーティスト名のうち抽出結果に含まれないものを本体(primary)、含まれるものを
// featuringとして表示順を決める純粋関数のテスト。抽出できない・名前が
// 一致しない場合は、richnessScore(カタログの豊富さ)の降順で本体を決める。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { extractFeaturedNames, determineBillingOrder, type BillingCandidate } from '../utils/featuringBillingOrder.ts'

describe('extractFeaturedNames', () => {
  test('extracts a single featured name from parentheses', () => {
    assert.deepEqual(extractFeaturedNames('Song (feat. Dan Hicks)'), ['Dan Hicks'])
  })

  test('extracts multiple comma/ampersand-separated names from brackets', () => {
    assert.deepEqual(extractFeaturedNames('Song [feat. Will Bernard & Robert Walter]'), ['Will Bernard', 'Robert Walter'])
  })

  test('extracts 3+ names mixing comma and ampersand', () => {
    assert.deepEqual(
      extractFeaturedNames('Song (feat. A, B & C)'),
      ['A', 'B', 'C']
    )
  })

  test('returns null when the title has no feat. pattern', () => {
    assert.equal(extractFeaturedNames('Plain Song Title'), null)
  })
})

describe('determineBillingOrder', () => {
  test('uses feat. parsing when an artist name in the group matches the extracted list', () => {
    const candidates: BillingCandidate[] = [
      { artistId: 'a1', artistName: 'The Christmas Jug Band', richnessScore: 1 },
      { artistId: 'a2', artistName: 'Dan Hicks', richnessScore: 5 },
    ]
    const result = determineBillingOrder('Under the Mistletoe (feat. Dan Hicks)', candidates)
    assert.deepEqual(result, [
      { artistId: 'a1', role: 'primary', billingOrder: 1 },
      { artistId: 'a2', role: 'featuring', billingOrder: 2 },
    ])
  })

  test('falls back to richnessScore descending when no group artist name matches the extracted feat. list', () => {
    const candidates: BillingCandidate[] = [
      { artistId: 'a1', artistName: 'ナイル・ロジャース', richnessScore: 3 },
      { artistId: 'a2', artistName: 'シック', richnessScore: 9 },
    ]
    const result = determineBillingOrder('"New Jack" Sober (feat. Craig David & Stefflon Don)', candidates)
    assert.deepEqual(result, [
      { artistId: 'a2', role: 'primary', billingOrder: 1 },
      { artistId: 'a1', role: 'featuring', billingOrder: 2 },
    ])
  })

  test('falls back to id string comparison when richnessScore also ties', () => {
    const candidates: BillingCandidate[] = [
      { artistId: 'z1', artistName: 'X', richnessScore: 1 },
      { artistId: 'a1', artistName: 'Y', richnessScore: 1 },
    ]
    const result = determineBillingOrder('Plain Title', candidates)
    assert.deepEqual(result, [
      { artistId: 'a1', role: 'primary', billingOrder: 1 },
      { artistId: 'z1', role: 'featuring', billingOrder: 2 },
    ])
  })

  test('orders 3+ featuring artists by their order of appearance in the extracted list', () => {
    const candidates: BillingCandidate[] = [
      { artistId: 'a-c', artistName: 'C', richnessScore: 1 },
      { artistId: 'a-main', artistName: 'Main Act', richnessScore: 1 },
      { artistId: 'a-b', artistName: 'B', richnessScore: 1 },
    ]
    const result = determineBillingOrder('Song (feat. B, C)', candidates)
    assert.deepEqual(result, [
      { artistId: 'a-main', role: 'primary', billingOrder: 1 },
      { artistId: 'a-b', role: 'featuring', billingOrder: 2 },
      { artistId: 'a-c', role: 'featuring', billingOrder: 3 },
    ])
  })
})
