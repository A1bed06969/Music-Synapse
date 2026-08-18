// __tests__/label-timeline.unit.test.ts
//
// レーベル年表のマージ・ソートロジックのユニットテスト。DB/サーバ不要、純粋関数のみ。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildLabelTimeline } from '../utils/labelTimeline.ts'

describe('buildLabelTimeline', () => {
  test('orders founding, founders, joins, leaves, releases, and awards chronologically', () => {
    const entries = buildLabelTimeline({
      foundedYear: 1959,
      founders: [{ name: 'Berry Gordy', role: '創業者' }],
      roster: [
        { artistId: 'a1', artistName: 'The Supremes', startDate: '1961-01-15', endDate: '1977-06-01' },
      ],
      catalog: [
        { albumId: 'al1', albumTitle: 'Where Did Our Love Go', artistName: 'The Supremes', releaseDate: '1964-08-01' },
      ],
      awards: [
        { year: 1965, awardName: 'Grammy', category: 'Best Group', result: 'Nominated', subjectName: 'The Supremes' },
      ],
    })

    assert.deepEqual(
      entries.map((e) => [e.date, e.kind]),
      [
        ['1959-01-01', 'founded'],
        ['1959-01-01', 'founder'],
        ['1961-01-15', 'joined'],
        ['1964-08-01', 'release'],
        ['1965-01-01', 'award'],
        ['1977-06-01', 'left'],
      ]
    )
    assert.equal(entries[0].title, 'レーベル発足')
    assert.equal(entries[1].title, 'Berry Gordy(創業者)が設立')
    assert.equal(entries[2].title, 'The Supremes 加入')
    assert.equal(entries[2].href, '/artists/a1')
    assert.equal(entries[3].title, 'The Supremes「Where Did Our Love Go」リリース')
    assert.equal(entries[3].href, '/albums/al1')
    assert.equal(entries[4].title, 'The Supremes Grammy Best Group(Nominated) 受賞')
    assert.equal(entries[5].title, 'The Supremes 脱退')
  })

  test('omits founding/founder entries when foundedYear is null', () => {
    const entries = buildLabelTimeline({
      foundedYear: null,
      founders: [{ name: 'Someone', role: null }],
      roster: [],
      catalog: [],
      awards: [],
    })
    assert.deepEqual(entries, [])
  })

  test('omits roster/catalog rows with no date', () => {
    const entries = buildLabelTimeline({
      foundedYear: null,
      founders: [],
      roster: [{ artistId: 'a1', artistName: 'No Date Artist', startDate: null, endDate: null }],
      catalog: [{ albumId: 'al1', albumTitle: 'Unreleased', artistName: 'No Date Artist', releaseDate: null }],
      awards: [],
    })
    assert.deepEqual(entries, [])
  })

  test('founder title omits role parentheses when role is null', () => {
    const entries = buildLabelTimeline({
      foundedYear: 1970,
      founders: [{ name: 'Anonymous', role: null }],
      roster: [],
      catalog: [],
      awards: [],
    })
    assert.equal(entries[1].title, 'Anonymousが設立')
  })
})
