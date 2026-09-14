// __tests__/track-credit-canonical.unit.test.ts
//
// 重複track候補の中から、非nullの補完可能フィールド数が最も多い行を本体として
// 選ぶ純粋関数のテスト。同数の場合はidの文字列比較で決定的に選ぶ。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { pickCanonicalTrack, type CanonicalCandidate, type EnrichmentFields } from '../utils/trackCreditCanonical.ts'

function enrichment(overrides: Partial<EnrichmentFields> = {}): EnrichmentFields {
  return {
    youtubeVideoId: null,
    previewUrl: null,
    appleMusicTrackId: null,
    spotifyTrackId: null,
    youtubeMusicTrackId: null,
    amazonMusicTrackId: null,
    lyricUrl: null,
    trackReview: null,
    ...overrides,
  }
}

describe('pickCanonicalTrack', () => {
  test('picks the candidate with the most non-null enrichment fields', () => {
    const result = pickCanonicalTrack([
      { id: 'c1', artistId: 'a1', enrichment: enrichment({ previewUrl: 'x' }) },
      { id: 'c2', artistId: 'a2', enrichment: enrichment({ previewUrl: 'x', youtubeVideoId: 'y', lyricUrl: 'z' }) },
    ])
    assert.equal(result.id, 'c2')
  })

  test('falls back to lexicographically smallest id when field counts tie', () => {
    const result = pickCanonicalTrack([
      { id: 'zzz', artistId: 'a1', enrichment: enrichment({ previewUrl: 'x' }) },
      { id: 'aaa', artistId: 'a2', enrichment: enrichment({ previewUrl: 'y' }) },
    ])
    assert.equal(result.id, 'aaa')
  })

  test('treats all-null enrichment as zero and still resolves deterministically', () => {
    const result = pickCanonicalTrack([
      { id: 'b', artistId: 'a1', enrichment: enrichment() },
      { id: 'a', artistId: 'a2', enrichment: enrichment() },
    ])
    assert.equal(result.id, 'a')
  })

  test('throws on an empty candidate list', () => {
    assert.throws(() => pickCanonicalTrack([]))
  })
})
