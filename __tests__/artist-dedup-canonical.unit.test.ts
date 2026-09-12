// __tests__/artist-dedup-canonical.unit.test.ts
//
// 重複アーティストの中から「本体」として残す1行を選ぶ純粋関数のテスト。
// 優先順位: track数 > album数 > 副次データスコア > id文字列比較。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { secondaryDataScore, pickCanonical, type ArtistCandidate } from '../utils/artistDedupCanonical.ts'

function candidate(overrides: Partial<ArtistCandidate> & { id: string }): ArtistCandidate {
  return {
    trackCount: 0,
    albumCount: 0,
    externalLinkCount: 0,
    genreCount: 0,
    relationCount: 0,
    mvBackfillLogCount: 0,
    hasBio: false,
    hasImage: false,
    ...overrides,
  }
}

describe('secondaryDataScore', () => {
  test('sums all secondary data fields, counting hasBio/hasImage as 1 each', () => {
    const score = secondaryDataScore(
      candidate({ id: 'a', externalLinkCount: 3, genreCount: 2, relationCount: 1, mvBackfillLogCount: 4, hasBio: true, hasImage: true })
    )
    assert.equal(score, 3 + 2 + 1 + 4 + 1 + 1)
  })

  test('is 0 for a candidate with no secondary data at all', () => {
    assert.equal(secondaryDataScore(candidate({ id: 'a' })), 0)
  })
})

describe('pickCanonical', () => {
  test('picks the candidate with the most tracks when counts differ', () => {
    const result = pickCanonical([
      candidate({ id: 'a', trackCount: 100 }),
      candidate({ id: 'b', trackCount: 477 }),
      candidate({ id: 'c', trackCount: 300 }),
    ])
    assert.equal(result.id, 'b')
  })

  test('falls back to album count when track counts tie', () => {
    const result = pickCanonical([
      candidate({ id: 'a', trackCount: 477, albumCount: 60 }),
      candidate({ id: 'b', trackCount: 477, albumCount: 67 }),
    ])
    assert.equal(result.id, 'b')
  })

  test('falls back to secondary data score when track and album counts both tie', () => {
    const result = pickCanonical([
      candidate({ id: 'a', trackCount: 477, albumCount: 67, externalLinkCount: 0 }),
      candidate({ id: 'b', trackCount: 477, albumCount: 67, externalLinkCount: 7 }),
    ])
    assert.equal(result.id, 'b')
  })

  test('falls back to the lexicographically smallest id as the final tie-break', () => {
    const result = pickCanonical([
      candidate({ id: 'MS_ART_zzz', trackCount: 477, albumCount: 67 }),
      candidate({ id: 'MS_ART_aaa', trackCount: 477, albumCount: 67 }),
    ])
    assert.equal(result.id, 'MS_ART_aaa')
  })

  test('reproduces the real スガシカオ case: 330-track candidate with 7 links loses to a tied 477-track candidate', () => {
    const result = pickCanonical([
      candidate({ id: 'rich-but-smaller', trackCount: 330, albumCount: 35, externalLinkCount: 7 }),
      candidate({ id: 'largest-a', trackCount: 477, albumCount: 67 }),
      candidate({ id: 'largest-b', trackCount: 477, albumCount: 67 }),
    ])
    assert.equal(result.id, 'largest-a')
  })

  test('throws on an empty candidate list', () => {
    assert.throws(() => pickCanonical([]))
  })
})
