// __tests__/artist-timeline.unit.test.ts
//
// アーティスト年表のマージ・ソートロジックのユニットテスト。DB/サーバ不要、純粋関数のみ。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildArtistTimeline } from '../utils/artistTimeline.ts'

describe('buildArtistTimeline', () => {
  test('orders releases, lives, festivals, and tie-ups chronologically', () => {
    const entries = buildArtistTimeline({
      releases: [{ albumId: 'al1', title: 'First Album', releaseDate: '2019-03-01', jacketUrl: 'https://example.com/jacket.jpg' }],
      lives: [{ id: 'ev1', name: 'ワンマンライブ', eventDate: '2020-06-15', venue: '渋谷クラブクアトロ' }],
      festivals: [{ appearanceId: 1, eventName: 'SUMMER SONIC', startTime: '2021-08-14T12:00:00+09:00', venue: 'ZOZOマリンスタジアム' }],
      tieUps: [{ id: 1, trackTitle: 'テーマ曲', workType: 'anime', workTitle: '鬼滅の刃', year: 2019, usageDetail: null, albumId: 'al1' }],
    })

    assert.deepEqual(
      entries.map((e) => [e.date, e.kind]),
      [
        ['2019-01-01', 'tieup'],
        ['2019-03-01', 'release'],
        ['2020-06-15', 'live'],
        ['2021-08-14', 'festival'],
      ]
    )
    assert.equal(entries[0].title, 'テーマ曲')
    assert.equal(entries[0].subtitle, '鬼滅の刃(アニメ)')
    assert.equal(entries[0].href, '/albums/al1')
    assert.equal(entries[1].title, 'First Album')
    assert.equal(entries[1].href, '/albums/al1')
    assert.equal(entries[1].imageUrl, 'https://example.com/jacket.jpg')
    assert.equal(entries[2].title, 'ワンマンライブ')
    assert.equal(entries[2].subtitle, '渋谷クラブクアトロ')
    assert.equal(entries[3].title, 'SUMMER SONIC')
    assert.equal(entries[3].subtitle, 'ZOZOマリンスタジアム')
  })

  test('omits entries with no resolvable date', () => {
    const entries = buildArtistTimeline({
      releases: [{ albumId: 'al1', title: 'No Date', releaseDate: null, jacketUrl: null }],
      lives: [{ id: 'ev1', name: 'No Date Live', eventDate: null, venue: null }],
      festivals: [{ appearanceId: 1, eventName: 'No Date Fes', startTime: null, venue: null }],
      tieUps: [{ id: 1, trackTitle: 'No Year', workType: 'cm', workTitle: 'XYZ', year: null, usageDetail: null, albumId: null }],
    })
    assert.deepEqual(entries, [])
  })

  test('tie-up without an album has no href', () => {
    const entries = buildArtistTimeline({
      releases: [],
      lives: [],
      festivals: [],
      tieUps: [{ id: 1, trackTitle: 'テーマ曲', workType: 'tv_program', workTitle: 'XYZ', year: 2022, usageDetail: null, albumId: null }],
    })
    assert.equal(entries[0].href, null)
  })

  test('festival date is derived from startTime, converted from UTC to JST (crosses midnight)', () => {
    const entries = buildArtistTimeline({
      releases: [],
      lives: [],
      festivals: [{ appearanceId: 1, eventName: 'FUJI ROCK', startTime: '2026-07-24T15:30:00+00:00', venue: null }],
      tieUps: [],
    })
    assert.equal(entries[0].date, '2026-07-25')
  })
})
