// __tests__/genre-history.unit.test.ts
//
// ジャンル年表(カード型UI)のコアロジックのユニットテスト。DB/サーバ不要、純粋関数のみ。
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getDescendantGenreIds, buildEraCards, type GenreRow, type LineageEdge, type HighlightRow } from '../utils/genreHistory.ts'

describe('getDescendantGenreIds', () => {
  test('a simple chain returns root + all descendants in BFS order', () => {
    const edges: LineageEdge[] = [
      { parentGenreId: 'A', childGenreId: 'B', relationType: 'derivation' },
      { parentGenreId: 'B', childGenreId: 'C', relationType: 'derivation' },
    ]
    assert.deepEqual(getDescendantGenreIds('A', edges), ['A', 'B', 'C'])
  })

  test('branching returns all branches', () => {
    const edges: LineageEdge[] = [
      { parentGenreId: 'A', childGenreId: 'B', relationType: 'derivation' },
      { parentGenreId: 'A', childGenreId: 'C', relationType: 'derivation' },
    ]
    assert.deepEqual(getDescendantGenreIds('A', edges), ['A', 'B', 'C'])
  })

  test('a genre with no children returns only itself', () => {
    const edges: LineageEdge[] = [{ parentGenreId: 'X', childGenreId: 'Y', relationType: 'derivation' }]
    assert.deepEqual(getDescendantGenreIds('A', edges), ['A'])
  })

  test('does not infinite-loop on a cycle (defensive)', () => {
    const edges: LineageEdge[] = [
      { parentGenreId: 'A', childGenreId: 'B', relationType: 'derivation' },
      { parentGenreId: 'B', childGenreId: 'A', relationType: 'derivation' },
    ]
    assert.deepEqual(getDescendantGenreIds('A', edges), ['A', 'B'])
  })
})

function genre(overrides: Partial<GenreRow> & { id: string }): GenreRow {
  return {
    name: overrides.id,
    originYear: null,
    originYearLabel: null,
    originCountry: null,
    backgroundNote: null,
    ...overrides,
  }
}

describe('buildEraCards', () => {
  test('cards are ordered by originYear ascending across a multi-level tree', () => {
    const genres: GenreRow[] = [
      genre({ id: 'blues', name: 'Blues', originYear: 1875 }),
      genre({ id: 'country', name: 'Country Blues', originYear: 1920 }),
      genre({ id: 'delta', name: 'Delta Blues', originYear: 1920 }),
      genre({ id: 'chicago', name: 'Chicago Blues', originYear: 1950 }),
    ]
    const edges: LineageEdge[] = [
      { parentGenreId: 'blues', childGenreId: 'country', relationType: 'derivation' },
      { parentGenreId: 'country', childGenreId: 'delta', relationType: 'derivation' },
      { parentGenreId: 'delta', childGenreId: 'chicago', relationType: 'derivation' },
    ]
    const cards = buildEraCards('blues', genres, edges, [])
    assert.deepEqual(
      cards.map((c) => c.genreId),
      ['blues', 'country', 'delta', 'chicago']
    )
  })

  test('a highlight only appears on the card of its own genre, not on ancestor cards', () => {
    const genres: GenreRow[] = [
      genre({ id: 'chicago', name: 'Chicago Blues', originYear: 1950 }),
      genre({ id: 'bluesrock', name: 'Blues Rock', originYear: 1960 }),
    ]
    const edges: LineageEdge[] = [{ parentGenreId: 'chicago', childGenreId: 'bluesrock', relationType: 'derivation' }]
    const highlights: HighlightRow[] = [
      {
        genreId: 'bluesrock',
        artistId: 'a1',
        artistName: 'The Rolling Stones',
        artistImageUrl: null,
        albumId: null,
        albumTitle: null,
        albumJacketUrl: null,
        eventYear: null,
        eventYearLabel: null,
        note: null,
      },
    ]
    const cards = buildEraCards('chicago', genres, edges, highlights)
    const chicagoCard = cards.find((c) => c.genreId === 'chicago')!
    const bluesRockCard = cards.find((c) => c.genreId === 'bluesrock')!
    assert.deepEqual(chicagoCard.representativeArtists, [])
    assert.equal(bluesRockCard.representativeArtists.length, 1)
    assert.equal(bluesRockCard.representativeArtists[0].name, 'The Rolling Stones')
  })

  test('color rotates through the 6 tokens and wraps around for a 7th card', () => {
    const ids = ['g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6']
    const genres: GenreRow[] = ids.map((id, i) => genre({ id, originYear: 1900 + i }))
    // g0はroot、残り6件は直列の子(depthは問わずoriginYear順に並べばよい)
    const edges: LineageEdge[] = []
    for (let i = 0; i < ids.length - 1; i++) {
      edges.push({ parentGenreId: ids[i], childGenreId: ids[i + 1], relationType: 'derivation' })
    }
    const cards = buildEraCards('g0', genres, edges, [])
    assert.deepEqual(
      cards.map((c) => c.colorToken),
      ['amber', 'yellow', 'green', 'blue', 'coral', 'purple', 'amber']
    )
  })

  test('a descendant genre with no originYear is excluded from the cards', () => {
    const genres: GenreRow[] = [
      genre({ id: 'blues', originYear: 1875 }),
      genre({ id: 'unknown', originYear: null }),
    ]
    const edges: LineageEdge[] = [{ parentGenreId: 'blues', childGenreId: 'unknown', relationType: 'derivation' }]
    const cards = buildEraCards('blues', genres, edges, [])
    assert.deepEqual(
      cards.map((c) => c.genreId),
      ['blues']
    )
  })

  test('representativeWorks and representativeArtists are empty when there are no highlights', () => {
    const genres: GenreRow[] = [genre({ id: 'blues', originYear: 1875 })]
    const cards = buildEraCards('blues', genres, [], [])
    assert.deepEqual(cards[0].representativeArtists, [])
    assert.deepEqual(cards[0].representativeWorks, [])
  })

  test('imageUrl prefers an artist image, falling back to an album jacket', () => {
    const genres: GenreRow[] = [genre({ id: 'blues', originYear: 1875 })]
    const highlights: HighlightRow[] = [
      {
        genreId: 'blues',
        artistId: 'a1',
        artistName: 'W.C. Handy',
        artistImageUrl: null,
        albumId: 'al1',
        albumTitle: 'St. Louis Blues',
        albumJacketUrl: 'https://example.com/jacket.jpg',
        eventYear: 1914,
        eventYearLabel: null,
        note: null,
      },
    ]
    const cards = buildEraCards('blues', genres, [], highlights)
    assert.equal(cards[0].imageUrl, 'https://example.com/jacket.jpg')
    assert.equal(cards[0].representativeWorks[0].year, 1914)
  })

  test('period label prefers originYearLabel over the raw year', () => {
    const genres: GenreRow[] = [genre({ id: 'blues', originYear: 1875, originYearLabel: '19世紀後半' })]
    const cards = buildEraCards('blues', genres, [], [])
    assert.equal(cards[0].period, '19世紀後半')
  })
})
