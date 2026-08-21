// __tests__/discogs-track-list.unit.test.ts
//
// Discogsのtracklist.position表記(CD1枚/CD複数枚/アナログ盤の面)から
// disc_number/track_noを組み立てるbuildTrackListのユニットテスト。
// DB/サーバ不要、純粋関数のみ。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildTrackList } from '../utils/discogs.ts'

describe('buildTrackList', () => {
  test('single-disc CD: plain numeric positions', () => {
    const tracks = buildTrackList([
      { position: '1', type_: 'track', title: 'A' },
      { position: '2', type_: 'track', title: 'B' },
    ])
    assert.deepEqual(tracks, [
      { discNumber: 1, trackNo: 1, title: 'A' },
      { discNumber: 1, trackNo: 2, title: 'B' },
    ])
  })

  test('multi-disc CD: "N-N" positions map directly to disc/track', () => {
    const tracks = buildTrackList([
      { position: '1-1', type_: 'track', title: 'A' },
      { position: '1-2', type_: 'track', title: 'B' },
      { position: '2-1', type_: 'track', title: 'C' },
    ])
    assert.deepEqual(tracks, [
      { discNumber: 1, trackNo: 1, title: 'A' },
      { discNumber: 1, trackNo: 2, title: 'B' },
      { discNumber: 2, trackNo: 1, title: 'C' },
    ])
  })

  test('single vinyl: bare A/B side letters (no per-side number) get a continuous count', () => {
    const tracks = buildTrackList([
      { position: 'A', type_: 'track', title: 'A' },
      { position: 'B', type_: 'track', title: 'B' },
    ])
    assert.deepEqual(tracks, [
      { discNumber: 1, trackNo: 1, title: 'A' },
      { discNumber: 1, trackNo: 2, title: 'B' },
    ])
  })

  // 実データで確認済みの不具合の再発防止テスト: 渚にて「本当の世界」
  // (discogs.com/release/2474704)は2xLPでA1〜A4/B1〜B4がdisc1、C1〜C2/D1〜D4が
  // disc2。各面が独自に1から番号を振っているため、その番号をそのまま使うと
  // B面(disc1の5曲目以降)でtrack_noが1に巻き戻ってしまっていた。
  test('2xLP with per-side numbering (A1-A4/B1-B4/C1-C2/D1-D4): track numbers continue across the paired sides instead of resetting', () => {
    const tracks = buildTrackList([
      { position: 'A1', type_: 'track', title: 'The True World' },
      { position: 'A2', type_: 'track', title: 'Wonder' },
      { position: 'A3', type_: 'track', title: 'Fall Of Evening' },
      { position: 'A4', type_: 'track', title: 'Time' },
      { position: 'B1', type_: 'track', title: 'Far Cry' },
      { position: 'B2', type_: 'track', title: 'Twilights' },
      { position: 'B3', type_: 'track', title: 'Will' },
      { position: 'B4', type_: 'track', title: 'She' },
      { position: 'C1', type_: 'track', title: 'The True Sun' },
      { position: 'C2', type_: 'track', title: 'Space Between I & I' },
      { position: 'D1', type_: 'track', title: 'Gone' },
      { position: 'D2', type_: 'track', title: 'Mourn' },
      { position: 'D3', type_: 'track', title: 'Anxiety' },
      { position: 'D4', type_: 'track', title: 'Rest' },
    ])
    assert.deepEqual(
      tracks.map((t) => `${t.discNumber}-${t.trackNo}`),
      ['1-1', '1-2', '1-3', '1-4', '1-5', '1-6', '1-7', '1-8', '2-1', '2-2', '2-3', '2-4', '2-5', '2-6']
    )
    assert.equal(tracks[4].title, 'Far Cry')
    assert.equal(tracks[8].title, 'The True Sun')
  })

  test('non-track entries (headings/indexes) and empty titles are skipped', () => {
    const tracks = buildTrackList([
      { position: '', type_: 'heading', title: 'Disc 1' },
      { position: '1', type_: 'track', title: 'A' },
      { position: '2', type_: 'track', title: '' },
    ])
    assert.deepEqual(tracks, [{ discNumber: 1, trackNo: 1, title: 'A' }])
  })
})
