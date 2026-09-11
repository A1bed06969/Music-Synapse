// __tests__/album-mv-order.unit.test.ts
//
// アルバムのMVタブ用に、YouTube動画を持つ収録曲を絞り込み・並び替えする
// 純粋関数のテスト。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { orderAlbumTracksForMv } from '../utils/albumMvOrder.ts'

describe('orderAlbumTracksForMv', () => {
  test('filters out tracks without a youtube_video_id', () => {
    const result = orderAlbumTracksForMv(
      [
        { id: 't1', disc_number: 1, track_no: 1, youtube_video_id: 'abc' },
        { id: 't2', disc_number: 1, track_no: 2, youtube_video_id: null },
      ],
      null
    )
    assert.deepEqual(result.map((t) => t.id), ['t1'])
  })

  test('sorts by disc_number then track_no ascending', () => {
    const result = orderAlbumTracksForMv(
      [
        { id: 't1', disc_number: 2, track_no: 1, youtube_video_id: 'a' },
        { id: 't2', disc_number: 1, track_no: 2, youtube_video_id: 'b' },
        { id: 't3', disc_number: 1, track_no: 1, youtube_video_id: 'c' },
      ],
      null
    )
    assert.deepEqual(result.map((t) => t.id), ['t3', 't2', 't1'])
  })

  test('treats a null disc_number as disc 1', () => {
    const result = orderAlbumTracksForMv(
      [
        { id: 't1', disc_number: null, track_no: 2, youtube_video_id: 'a' },
        { id: 't2', disc_number: 1, track_no: 1, youtube_video_id: 'b' },
      ],
      null
    )
    assert.deepEqual(result.map((t) => t.id), ['t2', 't1'])
  })

  test('moves the representative track to the front when present', () => {
    const result = orderAlbumTracksForMv(
      [
        { id: 't1', disc_number: 1, track_no: 1, youtube_video_id: 'a' },
        { id: 't2', disc_number: 1, track_no: 2, youtube_video_id: 'b' },
        { id: 't3', disc_number: 1, track_no: 3, youtube_video_id: 'c' },
      ],
      't3'
    )
    assert.deepEqual(result.map((t) => t.id), ['t3', 't1', 't2'])
  })

  test('leaves order unchanged when the representative track has no video', () => {
    const result = orderAlbumTracksForMv(
      [
        { id: 't1', disc_number: 1, track_no: 1, youtube_video_id: 'a' },
        { id: 't2', disc_number: 1, track_no: 2, youtube_video_id: null },
      ],
      't2'
    )
    assert.deepEqual(result.map((t) => t.id), ['t1'])
  })

  test('returns an empty array when no tracks have a video', () => {
    const result = orderAlbumTracksForMv(
      [{ id: 't1', disc_number: 1, track_no: 1, youtube_video_id: null }],
      null
    )
    assert.deepEqual(result, [])
  })
})
