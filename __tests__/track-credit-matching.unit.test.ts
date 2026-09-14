// フィーチャリング曲が複数アーティストに分散している行を、apple_music_track_id
// (優先)またはtitle+albumTitle+trackNo+durationSecondsの完全一致でグループ化する
// 純粋関数のテスト。同一artist_id内に一致行が複数ある場合はあいまいとして
// スキップする。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { groupTrackCredits, type TrackCreditRow } from '../utils/trackCreditMatching.ts'

function row(overrides: Partial<TrackCreditRow> & { id: string; artistId: string }): TrackCreditRow {
  return {
    appleMusicTrackId: null,
    title: 'Song',
    albumId: 'alb-1',
    albumTitle: 'Album',
    trackNo: 1,
    durationSeconds: 200,
    ...overrides,
  }
}

describe('groupTrackCredits', () => {
  test('groups two rows sharing the same apple_music_track_id across different artists', () => {
    const rows = [
      row({ id: 't1', artistId: 'a1', appleMusicTrackId: '999' }),
      row({ id: 't2', artistId: 'a2', appleMusicTrackId: '999' }),
    ]
    const result = groupTrackCredits(rows)
    assert.equal(result.groups.length, 1)
    assert.deepEqual(
      result.groups[0].rows.map((r) => r.id).sort(),
      ['t1', 't2']
    )
    assert.deepEqual(result.ambiguousKeys, [])
  })

  test('does not group rows from the same artist_id even if apple_music_track_id matches', () => {
    const rows = [
      row({ id: 't1', artistId: 'a1', appleMusicTrackId: '999' }),
      row({ id: 't2', artistId: 'a1', appleMusicTrackId: '999' }),
    ]
    const result = groupTrackCredits(rows)
    assert.equal(result.groups.length, 0)
    assert.equal(result.ambiguousKeys.length, 1)
  })

  test('falls back to title+albumTitle+trackNo+durationSeconds when apple_music_track_id is null', () => {
    const rows = [
      row({ id: 't1', artistId: 'a1', appleMusicTrackId: null, title: 'Duet', albumTitle: 'LP', trackNo: 3, durationSeconds: 180 }),
      row({ id: 't2', artistId: 'a2', appleMusicTrackId: null, title: 'Duet', albumTitle: 'LP', trackNo: 3, durationSeconds: 180 }),
    ]
    const result = groupTrackCredits(rows)
    assert.equal(result.groups.length, 1)
    assert.deepEqual(
      result.groups[0].rows.map((r) => r.id).sort(),
      ['t1', 't2']
    )
  })

  test('fallback still matches when trackNo is null on both sides (field dropped from comparison)', () => {
    const rows = [
      row({ id: 't1', artistId: 'a1', appleMusicTrackId: null, title: 'Duet', albumTitle: 'LP', trackNo: null, durationSeconds: 180 }),
      row({ id: 't2', artistId: 'a2', appleMusicTrackId: null, title: 'Duet', albumTitle: 'LP', trackNo: null, durationSeconds: 180 }),
    ]
    const result = groupTrackCredits(rows)
    assert.equal(result.groups.length, 1)
  })

  test('does not cross-match a row with apple_music_track_id against a row without one, even with identical title/album', () => {
    const rows = [
      row({ id: 't1', artistId: 'a1', appleMusicTrackId: '999', title: 'Duet', albumTitle: 'LP', trackNo: 3, durationSeconds: 180 }),
      row({ id: 't2', artistId: 'a2', appleMusicTrackId: null, title: 'Duet', albumTitle: 'LP', trackNo: 3, durationSeconds: 180 }),
    ]
    const result = groupTrackCredits(rows)
    assert.equal(result.groups.length, 0)
  })

  test('a group of 3 distinct artists forms a single group', () => {
    const rows = [
      row({ id: 't1', artistId: 'a1', appleMusicTrackId: '999' }),
      row({ id: 't2', artistId: 'a2', appleMusicTrackId: '999' }),
      row({ id: 't3', artistId: 'a3', appleMusicTrackId: '999' }),
    ]
    const result = groupTrackCredits(rows)
    assert.equal(result.groups.length, 1)
    assert.equal(result.groups[0].rows.length, 3)
  })

  test('a single row (no cross-artist duplicate) produces no group', () => {
    const rows = [row({ id: 't1', artistId: 'a1', appleMusicTrackId: '999' })]
    const result = groupTrackCredits(rows)
    assert.equal(result.groups.length, 0)
    assert.equal(result.ambiguousKeys.length, 0)
  })
})
