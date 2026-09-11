// __tests__/youtube-mv-match.unit.test.ts
//
// 確定済み公式チャンネルの動画タイトル一覧から、トラックの公式MVを特定する
// 純粋関数のテスト。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { findBestMvMatch, hasNegativeMvKeyword } from '../utils/youtubeMvMatch.ts'

describe('hasNegativeMvKeyword', () => {
  test('detects English negative keywords', () => {
    assert.equal(hasNegativeMvKeyword('Song Title (Lyric Video)'), true)
    assert.equal(hasNegativeMvKeyword('Song Title - Live at Budokan'), true)
  })

  test('detects Japanese negative keywords', () => {
    assert.equal(hasNegativeMvKeyword('曲名(歌詞付き)'), true)
    assert.equal(hasNegativeMvKeyword('曲名(カバー)'), true)
  })

  test('does not flag a plain title', () => {
    assert.equal(hasNegativeMvKeyword('Song Title (Official Music Video)'), false)
    assert.equal(hasNegativeMvKeyword('曲名'), false)
  })
})

describe('findBestMvMatch', () => {
  test('matches a track title against a decorated official video title', () => {
    const result = findBestMvMatch('Song Title', [
      { videoId: 'v1', title: 'Song Title (Official Music Video)' },
    ])
    assert.deepEqual(result, { videoId: 'v1', title: 'Song Title (Official Music Video)' })
  })

  test('matches a bare, undecorated upload with no suffix at all', () => {
    const result = findBestMvMatch('Song Title', [{ videoId: 'v1', title: 'Song Title' }])
    assert.deepEqual(result, { videoId: 'v1', title: 'Song Title' })
  })

  test('excludes a lyric video even if the core title matches', () => {
    const result = findBestMvMatch('Song Title', [{ videoId: 'v1', title: 'Song Title (Lyric Video)' }])
    assert.equal(result, null)
  })

  test('excludes a live version while still matching the official video among several candidates', () => {
    const result = findBestMvMatch('Song Title', [
      { videoId: 'v1', title: 'Song Title (Live)' },
      { videoId: 'v2', title: 'Song Title (Official Music Video)' },
      { videoId: 'v3', title: 'Unrelated Song' },
    ])
    assert.deepEqual(result, { videoId: 'v2', title: 'Song Title (Official Music Video)' })
  })

  test('returns null when no video title matches the track at all', () => {
    const result = findBestMvMatch('Song Title', [{ videoId: 'v1', title: 'A Completely Different Song' }])
    assert.equal(result, null)
  })

  test('returns null when two equally plausible candidates remain with no positive keyword to break the tie', () => {
    const result = findBestMvMatch('Song Title', [
      { videoId: 'v1', title: 'Song Title' },
      { videoId: 'v2', title: 'Song Title (4K)' },
    ])
    assert.equal(result, null)
  })

  test('picks the one candidate with an explicit official-MV keyword when multiple core-title matches remain', () => {
    const result = findBestMvMatch('Song Title', [
      { videoId: 'v1', title: 'Song Title (4K Remaster)' },
      { videoId: 'v2', title: 'Song Title (Official Video)' },
    ])
    assert.deepEqual(result, { videoId: 'v2', title: 'Song Title (Official Video)' })
  })

  test('is case-insensitive and tolerant of full-width parentheses', () => {
    const result = findBestMvMatch('Song Title', [{ videoId: 'v1', title: 'SONG TITLE（Official Video）' }])
    assert.deepEqual(result, { videoId: 'v1', title: 'SONG TITLE（Official Video）' })
  })

  test('returns null for an empty video list', () => {
    const result = findBestMvMatch('Song Title', [])
    assert.equal(result, null)
  })
})
