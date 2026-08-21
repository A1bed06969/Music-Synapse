// __tests__/genre-timeline.unit.test.ts
//
// ジャンル年表のマージ・ソートロジックのユニットテスト。DB/サーバ不要、純粋関数のみ。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildGenreTimeline } from '../utils/genreTimeline.ts'

describe('buildGenreTimeline', () => {
  test('orders origin, derived subgenres, highlights, and releases chronologically', () => {
    const entries = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'Techno',
      originYear: 1985,
      originYearLabel: null,
      originPlace: 'Detroit, Michigan',
      children: [
        { genreId: 'g2', genreName: 'Acid Techno', originYear: 1987, originYearLabel: null, originPlace: 'Chicago' },
      ],
      highlights: [
        { genreId: 'g1', artistId: 'a1', artistName: 'Juan Atkins', albumId: null, albumTitle: null, note: null },
      ],
      releases: [
        { albumId: 'al1', albumTitle: "No UFO's", artistName: 'Model 500', releaseDate: '1985-05-01' },
      ],
    })

    assert.deepEqual(
      entries.map((e) => [e.date, e.kind]),
      [
        ['1985-01-01', 'origin'],
        ['1985-01-01', 'highlight'],
        ['1985-05-01', 'release'],
        ['1987-01-01', 'derived'],
      ]
    )
    assert.equal(entries[0].title, 'Techno 発祥')
    assert.equal(entries[0].subtitle, 'Detroit, Michigan')
    assert.equal(entries[0].indent, false)
    assert.equal(entries[1].title, '代表: Juan Atkins')
    assert.equal(entries[1].indent, false)
    assert.equal(entries[2].title, "Model 500「No UFO's」リリース")
    assert.equal(entries[2].href, '/albums/al1')
    assert.equal(entries[3].title, 'Acid Technoが派生')
    assert.equal(entries[3].subtitle, 'Chicago')
    assert.equal(entries[3].href, '/genres/g2')
    assert.equal(entries[3].indent, true)
  })

  test('omits the origin entry when originYear is null', () => {
    const entries = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'X',
      originYear: null,
      originYearLabel: null,
      originPlace: null,
      children: [],
      highlights: [],
      releases: [],
    })
    assert.deepEqual(entries, [])
  })

  test('omits a child derived entry with no originYear, and a highlight whose genre has no resolvable year', () => {
    const entries = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'X',
      originYear: 1970,
      originYearLabel: null,
      originPlace: null,
      children: [
        { genreId: 'g2', genreName: 'Y (no year)', originYear: null, originYearLabel: null, originPlace: null },
      ],
      highlights: [
        { genreId: 'g3', artistId: 'a1', artistName: 'Unrelated', albumId: null, albumTitle: null, note: null },
      ],
      releases: [],
    })
    assert.deepEqual(entries.map((e) => e.kind), ['origin'])
  })

  test('highlight title combines artist and album when both are present', () => {
    const entries = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'X',
      originYear: 1970,
      originYearLabel: null,
      originPlace: null,
      children: [],
      highlights: [
        { genreId: 'g1', artistId: 'a1', artistName: 'Artist A', albumId: 'al1', albumTitle: 'Album A', note: null },
      ],
      releases: [],
    })
    assert.equal(entries[1].title, '代表: Artist A「Album A」')
  })

  test('highlight title falls back to album title alone when artistName is null', () => {
    const entries = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'X',
      originYear: 1970,
      originYearLabel: null,
      originPlace: null,
      children: [],
      highlights: [
        { genreId: 'g1', artistId: null, artistName: null, albumId: 'al1', albumTitle: 'Album A', note: null },
      ],
      releases: [],
    })
    assert.equal(entries[1].title, '代表: 「Album A」')
  })

  test('origin/derived subtitles show originYearLabel ahead of originPlace when the year is only approximate', () => {
    const entries = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'ジャズ',
      originYear: 1850,
      originYearLabel: '19世紀',
      originPlace: 'アメリカ南部（諸説あり）',
      children: [
        { genreId: 'g2', genreName: 'ビバップ', originYear: 1875, originYearLabel: '19世紀後半', originPlace: null },
      ],
      highlights: [],
      releases: [],
    })
    assert.equal(entries[0].subtitle, '19世紀 ・ アメリカ南部（諸説あり）')
    assert.equal(entries[1].subtitle, '19世紀後半')
  })

  test('release entries with no releaseDate are omitted', () => {
    const entries = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'X',
      originYear: null,
      originYearLabel: null,
      originPlace: null,
      children: [],
      highlights: [],
      releases: [{ albumId: 'al1', albumTitle: 'Unreleased', artistName: 'Someone', releaseDate: null }],
    })
    assert.deepEqual(entries, [])
  })
})
