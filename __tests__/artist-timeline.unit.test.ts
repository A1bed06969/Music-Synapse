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
      mediaSelections: [],
      awards: [],
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
      mediaSelections: [{ id: 'rr1', date: null, trackTitle: 'No Date Media', mediaName: null, programName: null }],
      awards: [{ id: 1, year: null, awardName: 'No Year Award', category: null, result: null }],
    })
    assert.deepEqual(entries, [])
  })

  test('tie-up without an album has no href', () => {
    const entries = buildArtistTimeline({
      releases: [],
      lives: [],
      festivals: [],
      tieUps: [{ id: 1, trackTitle: 'テーマ曲', workType: 'tv_program', workTitle: 'XYZ', year: 2022, usageDetail: null, albumId: null }],
      mediaSelections: [],
      awards: [],
    })
    assert.equal(entries[0].href, null)
  })

  test('festival date is derived from startTime, converted from UTC to JST (crosses midnight)', () => {
    const entries = buildArtistTimeline({
      releases: [],
      lives: [],
      festivals: [{ appearanceId: 1, eventName: 'FUJI ROCK', startTime: '2026-07-24T15:30:00+00:00', venue: null }],
      tieUps: [],
      mediaSelections: [],
      awards: [],
    })
    assert.equal(entries[0].date, '2026-07-25')
  })

  test('groups same-named lives into one tour entry spanning the date range', () => {
    const entries = buildArtistTimeline({
      releases: [],
      lives: [
        { id: 'ev1', name: '全国ツアー「XXX」', eventDate: '2021-05-10', venue: '渋谷クラブクアトロ' },
        { id: 'ev2', name: '全国ツアー「XXX」', eventDate: '2021-08-20', venue: 'なんばHatch' },
        { id: 'ev3', name: '全国ツアー「XXX」', eventDate: '2021-06-01', venue: 'Zepp Nagoya' },
      ],
      festivals: [],
      tieUps: [],
      mediaSelections: [],
      awards: [],
    })
    assert.equal(entries.length, 1)
    assert.equal(entries[0].date, '2021-05-10')
    assert.equal(entries[0].title, '全国ツアー「XXX」')
    assert.equal(entries[0].subtitle, '2021.05〜2021.08(3公演)')
  })

  test('single-date live keeps showing its venue as subtitle (no range/count)', () => {
    const entries = buildArtistTimeline({
      releases: [],
      lives: [{ id: 'ev1', name: 'ワンマンライブ', eventDate: '2020-06-15', venue: '渋谷クラブクアトロ' }],
      festivals: [],
      tieUps: [],
      mediaSelections: [],
      awards: [],
    })
    assert.equal(entries[0].subtitle, '渋谷クラブクアトロ')
  })

  test('distinct tour names are not merged with each other', () => {
    const entries = buildArtistTimeline({
      releases: [],
      lives: [
        { id: 'ev1', name: 'ツアーA', eventDate: '2020-01-01', venue: null },
        { id: 'ev2', name: 'ツアーB', eventDate: '2020-02-01', venue: null },
      ],
      festivals: [],
      tieUps: [],
      mediaSelections: [],
      awards: [],
    })
    assert.equal(entries.length, 2)
    assert.deepEqual(entries.map((e) => e.title).sort(), ['ツアーA', 'ツアーB'])
  })

  test('media selection (radio power play etc.) shows media/program name as subtitle', () => {
    const entries = buildArtistTimeline({
      releases: [],
      lives: [],
      festivals: [],
      tieUps: [],
      mediaSelections: [
        { id: 'rr1', date: '2026-07-01', trackTitle: '新女神', mediaName: 'エフエム北海道', programName: 'POWER PLAY' },
      ],
      awards: [],
    })
    assert.equal(entries.length, 1)
    assert.equal(entries[0].date, '2026-07-01')
    assert.equal(entries[0].kind, 'media')
    assert.equal(entries[0].title, '新女神')
    assert.equal(entries[0].subtitle, 'エフエム北海道 POWER PLAY')
  })

  test('groups same-day media selections for the same track into one row with a station count', () => {
    const entries = buildArtistTimeline({
      releases: [],
      lives: [],
      festivals: [],
      tieUps: [],
      mediaSelections: [
        { id: 'rr1', date: '2026-07-01', trackTitle: '新女神', mediaName: 'エフエム北海道', programName: 'POWER PLAY' },
        { id: 'rr2', date: '2026-07-01', trackTitle: '新女神', mediaName: 'エフエム青森', programName: 'Monthly On Air' },
        { id: 'rr3', date: '2026-07-01', trackTitle: '新女神', mediaName: 'TBC東北放送', programName: 'イチオシパワープレイ' },
      ],
      awards: [],
    })
    assert.equal(entries.length, 1)
    assert.equal(entries[0].date, '2026-07-01')
    assert.equal(entries[0].kind, 'media')
    assert.equal(entries[0].title, '新女神')
    assert.equal(entries[0].subtitle, '全国3局にてパワープレイ選出')
  })

  test('media selections spanning multiple months show a month range before the station count', () => {
    const entries = buildArtistTimeline({
      releases: [],
      lives: [],
      festivals: [],
      tieUps: [],
      mediaSelections: [
        { id: 'rr1', date: '2026-07-01', trackTitle: 'X', mediaName: 'A局', programName: null },
        { id: 'rr2', date: '2026-09-01', trackTitle: 'X', mediaName: 'B局', programName: null },
      ],
      awards: [],
    })
    assert.equal(entries.length, 1)
    assert.equal(entries[0].date, '2026-07-01')
    assert.equal(entries[0].subtitle, '2026.07〜2026.09・全国2局にてパワープレイ選出')
  })

  test('media selections for distinct tracks are not merged with each other', () => {
    const entries = buildArtistTimeline({
      releases: [],
      lives: [],
      festivals: [],
      tieUps: [],
      mediaSelections: [
        { id: 'rr1', date: '2026-07-01', trackTitle: 'トラックA', mediaName: 'A局', programName: null },
        { id: 'rr2', date: '2026-07-01', trackTitle: 'トラックB', mediaName: 'B局', programName: null },
      ],
      awards: [],
    })
    assert.equal(entries.length, 2)
    assert.deepEqual(entries.map((e) => e.title).sort(), ['トラックA', 'トラックB'])
  })

  test('award entry synthesizes a date from year and combines name/category/result into the title', () => {
    const entries = buildArtistTimeline({
      releases: [],
      lives: [],
      festivals: [],
      tieUps: [],
      mediaSelections: [],
      awards: [{ id: 1, year: 2021, awardName: '日本レコード大賞', category: '最優秀新人賞', result: '受賞' }],
    })
    assert.equal(entries.length, 1)
    assert.equal(entries[0].date, '2021-01-01')
    assert.equal(entries[0].kind, 'award')
    assert.equal(entries[0].title, '日本レコード大賞 最優秀新人賞(受賞)')
  })
})
