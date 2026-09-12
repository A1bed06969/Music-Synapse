// __tests__/artist-dedup-matching.unit.test.ts
//
// 重複アーティストのアルバム・トラックを、タイトル完全一致で対応付ける
// 純粋関数のテスト。同名が複数ある場合は推測せず「あいまい」として除外する。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { matchAlbums, matchTracks, type AlbumRow, type TrackRow } from '../utils/artistDedupMatching.ts'

describe('matchAlbums', () => {
  test('matches albums with the same title 1:1', () => {
    const canonical: AlbumRow[] = [{ id: 'c1', title: 'Progress' }]
    const duplicate: AlbumRow[] = [{ id: 'd1', title: 'Progress' }]
    const result = matchAlbums(canonical, duplicate)
    assert.deepEqual(result.matched, [{ canonicalId: 'c1', duplicateId: 'd1' }])
    assert.deepEqual(result.ambiguousTitles, [])
  })

  test('does not match a duplicate album whose title has no counterpart', () => {
    const canonical: AlbumRow[] = [{ id: 'c1', title: 'Progress' }]
    const duplicate: AlbumRow[] = [{ id: 'd1', title: 'Only In Duplicate' }]
    const result = matchAlbums(canonical, duplicate)
    assert.deepEqual(result.matched, [])
    assert.deepEqual(result.ambiguousTitles, [])
  })

  test('flags a title as ambiguous when it appears more than once on either side, and does not match it', () => {
    const canonical: AlbumRow[] = [
      { id: 'c1', title: 'Best' },
      { id: 'c2', title: 'Best' },
    ]
    const duplicate: AlbumRow[] = [{ id: 'd1', title: 'Best' }]
    const result = matchAlbums(canonical, duplicate)
    assert.deepEqual(result.matched, [])
    assert.deepEqual(result.ambiguousTitles, ['Best'])
  })

  test('matches multiple distinct titles independently', () => {
    const canonical: AlbumRow[] = [
      { id: 'c1', title: 'Progress' },
      { id: 'c2', title: 'Sofa' },
    ]
    const duplicate: AlbumRow[] = [
      { id: 'd1', title: 'Sofa' },
      { id: 'd2', title: 'Progress' },
    ]
    const result = matchAlbums(canonical, duplicate)
    assert.deepEqual(
      result.matched.sort((a, b) => a.canonicalId.localeCompare(b.canonicalId)),
      [
        { canonicalId: 'c1', duplicateId: 'd2' },
        { canonicalId: 'c2', duplicateId: 'd1' },
      ]
    )
  })
})

describe('matchTracks', () => {
  test('matches by title + disc_number + track_no when both sides have both numbers set', () => {
    const canonical: TrackRow[] = [{ id: 'c1', title: 'Progress', disc_number: 1, track_no: 3 }]
    const duplicate: TrackRow[] = [{ id: 'd1', title: 'Progress', disc_number: 1, track_no: 3 }]
    const result = matchTracks(canonical, duplicate)
    assert.deepEqual(result.matched, [{ canonicalId: 'c1', duplicateId: 'd1' }])
  })

  test('does not match when disc_number/track_no both present but differ, even if titles match, unless a title-only fallback applies uniquely', () => {
    const canonical: TrackRow[] = [{ id: 'c1', title: 'Progress', disc_number: 1, track_no: 3 }]
    const duplicate: TrackRow[] = [{ id: 'd1', title: 'Progress', disc_number: 2, track_no: 5 }]
    const result = matchTracks(canonical, duplicate)
    // 曲番号は不一致だがタイトルはユニークに1件ずつ対応するので、タイトルのみの
    // フォールバック(第2階層)で一致する
    assert.deepEqual(result.matched, [{ canonicalId: 'c1', duplicateId: 'd1' }])
  })

  test('falls back to title-only match when track_no is missing on one side', () => {
    const canonical: TrackRow[] = [{ id: 'c1', title: 'Progress', disc_number: null, track_no: null }]
    const duplicate: TrackRow[] = [{ id: 'd1', title: 'Progress', disc_number: 1, track_no: 3 }]
    const result = matchTracks(canonical, duplicate)
    assert.deepEqual(result.matched, [{ canonicalId: 'c1', duplicateId: 'd1' }])
  })

  test('flags a title as ambiguous when the title-only fallback finds more than one candidate on either side', () => {
    const canonical: TrackRow[] = [
      { id: 'c1', title: 'Progress', disc_number: null, track_no: null },
      { id: 'c2', title: 'Progress', disc_number: null, track_no: null },
    ]
    const duplicate: TrackRow[] = [{ id: 'd1', title: 'Progress', disc_number: null, track_no: null }]
    const result = matchTracks(canonical, duplicate)
    assert.deepEqual(result.matched, [])
    assert.deepEqual(result.ambiguousTitles, ['Progress'])
  })

  test('does not double-match a track already matched by the disc/track_no tier in the title-only fallback pass', () => {
    const canonical: TrackRow[] = [
      { id: 'c1', title: 'Progress', disc_number: 1, track_no: 1 },
      { id: 'c2', title: 'Progress', disc_number: 1, track_no: 2 },
    ]
    const duplicate: TrackRow[] = [
      { id: 'd1', title: 'Progress', disc_number: 1, track_no: 1 },
      { id: 'd2', title: 'Progress', disc_number: 1, track_no: 2 },
    ]
    const result = matchTracks(canonical, duplicate)
    assert.deepEqual(
      result.matched.sort((a, b) => a.canonicalId.localeCompare(b.canonicalId)),
      [
        { canonicalId: 'c1', duplicateId: 'd1' },
        { canonicalId: 'c2', duplicateId: 'd2' },
      ]
    )
    assert.deepEqual(result.ambiguousTitles, [])
  })
})
