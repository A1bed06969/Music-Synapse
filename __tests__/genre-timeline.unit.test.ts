// __tests__/genre-timeline.unit.test.ts
//
// ジャンル年表のマージ・エリア別グルーピング・ソートロジックのユニットテスト。
// DB/サーバ不要、純粋関数のみ。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildGenreTimeline } from '../utils/genreTimeline.ts'

describe('buildGenreTimeline', () => {
  test('groups by originCountry, and within a group orders origin/highlight/release/derived chronologically', () => {
    const groups = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'Techno',
      originYear: 1985,
      originYearLabel: null,
      originCountry: 'アメリカ',
      backgroundNote: null,
      children: [
        { genreId: 'g2', genreName: 'Acid Techno', originYear: 1987, originYearLabel: null, originCountry: 'アメリカ', backgroundNote: null },
      ],
      highlights: [
        { genreId: 'g1', artistId: 'a1', artistName: 'Juan Atkins', albumId: null, albumTitle: null, note: null, eventYear: null, eventYearLabel: null },
      ],
      releases: [
        { albumId: 'al1', albumTitle: "No UFO's", artistName: 'Model 500', releaseDate: '1985-05-01' },
      ],
    })

    assert.equal(groups.length, 1)
    assert.equal(groups[0].area, 'アメリカ')
    const entries = groups[0].entries
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
    assert.equal(entries[0].indent, false)
    assert.equal(entries[1].title, '代表: Juan Atkins')
    assert.equal(entries[1].indent, false)
    assert.equal(entries[2].title, "Model 500「No UFO's」リリース")
    assert.equal(entries[2].href, '/albums/al1')
    assert.equal(entries[3].title, 'Acid Technoが派生')
    assert.equal(entries[3].href, '/genres/g2')
    assert.equal(entries[3].indent, true)
  })

  test('a child genre with a different originCountry lands in its own group, ordered by that group earliest date', () => {
    const groups = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'Techno',
      originYear: 1985,
      originYearLabel: null,
      originCountry: 'アメリカ',
      backgroundNote: null,
      children: [
        { genreId: 'g2', genreName: 'UK Garage', originYear: 1994, originYearLabel: null, originCountry: 'イギリス', backgroundNote: null },
      ],
      highlights: [],
      releases: [],
    })

    assert.equal(groups.length, 2)
    assert.equal(groups[0].area, 'アメリカ')
    assert.equal(groups[1].area, 'イギリス')
    assert.equal(groups[1].entries[0].title, 'UK Garageが派生')
  })

  test('entries with no originCountry fall into "エリア不明" and are sorted last', () => {
    const groups = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'X',
      originYear: 1970,
      originYearLabel: null,
      originCountry: null,
      backgroundNote: null,
      children: [
        { genreId: 'g2', genreName: 'Y', originYear: 1980, originYearLabel: null, originCountry: 'イギリス', backgroundNote: null },
      ],
      highlights: [],
      releases: [],
    })

    assert.equal(groups.length, 2)
    assert.equal(groups[0].area, 'イギリス')
    assert.equal(groups[1].area, 'エリア不明')
  })

  test('returns no groups when there is nothing dated at all', () => {
    const groups = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'X',
      originYear: null,
      originYearLabel: null,
      originCountry: null,
      backgroundNote: null,
      children: [],
      highlights: [],
      releases: [],
    })
    assert.deepEqual(groups, [])
  })

  test('omits a child derived entry with no originYear, and a highlight whose genre has no resolvable year', () => {
    const groups = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'X',
      originYear: 1970,
      originYearLabel: null,
      originCountry: 'アメリカ',
      backgroundNote: null,
      children: [
        { genreId: 'g2', genreName: 'Y (no year)', originYear: null, originYearLabel: null, originCountry: null, backgroundNote: null },
      ],
      highlights: [
        { genreId: 'g3', artistId: 'a1', artistName: 'Unrelated', albumId: null, albumTitle: null, note: null, eventYear: null, eventYearLabel: null },
      ],
      releases: [],
    })
    assert.equal(groups.length, 1)
    assert.deepEqual(groups[0].entries.map((e) => e.kind), ['origin'])
  })

  test('highlight title combines artist and album when both are present', () => {
    const groups = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'X',
      originYear: 1970,
      originYearLabel: null,
      originCountry: 'アメリカ',
      backgroundNote: null,
      children: [],
      highlights: [
        { genreId: 'g1', artistId: 'a1', artistName: 'Artist A', albumId: 'al1', albumTitle: 'Album A', note: null, eventYear: null, eventYearLabel: null },
      ],
      releases: [],
    })
    assert.equal(groups[0].entries[1].title, '代表: Artist A「Album A」')
  })

  test('highlight title falls back to album title alone when artistName is null', () => {
    const groups = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'X',
      originYear: 1970,
      originYearLabel: null,
      originCountry: 'アメリカ',
      backgroundNote: null,
      children: [],
      highlights: [
        { genreId: 'g1', artistId: null, artistName: null, albumId: 'al1', albumTitle: 'Album A', note: null, eventYear: null, eventYearLabel: null },
      ],
      releases: [],
    })
    assert.equal(groups[0].entries[1].title, '代表: 「Album A」')
  })

  test('origin/derived subtitle shows originYearLabel when the year is only approximate, and null otherwise', () => {
    const groups = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'ジャズ',
      originYear: 1850,
      originYearLabel: '19世紀',
      originCountry: 'アメリカ',
      backgroundNote: null,
      children: [
        { genreId: 'g2', genreName: 'ビバップ', originYear: 1875, originYearLabel: '19世紀後半', originCountry: 'アメリカ', backgroundNote: null },
      ],
      highlights: [],
      releases: [],
    })
    assert.equal(groups[0].entries[0].subtitle, '19世紀')
    assert.equal(groups[0].entries[1].subtitle, '19世紀後半')
  })

  test('release entries with no releaseDate are omitted', () => {
    const groups = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'X',
      originYear: null,
      originYearLabel: null,
      originCountry: null,
      backgroundNote: null,
      children: [],
      highlights: [],
      releases: [{ albumId: 'al1', albumTitle: 'Unreleased', artistName: 'Someone', releaseDate: null }],
    })
    assert.deepEqual(groups, [])
  })
})
