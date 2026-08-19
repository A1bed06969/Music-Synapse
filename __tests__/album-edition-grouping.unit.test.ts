// __tests__/album-edition-grouping.unit.test.ts
//
// アルバムの「版」をタイトル正規化でグループ化するロジックの純粋関数テスト。
// 実データ(Cardi B "AM I THE DRAMA?"シリーズ)由来のケースを含む。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAlbumTitleForGrouping, groupAlbumsForEditionMerge } from '../utils/albumEditionGrouping.ts'

describe('normalizeAlbumTitleForGrouping', () => {
  test('strips a trailing edition-keyword parenthetical', () => {
    assert.equal(normalizeAlbumTitleForGrouping('AM I THE DRAMA? (Bonus Edition)'), 'AM I THE DRAMA?')
  })

  test('strips multiple trailing edition-keyword parentheticals', () => {
    assert.equal(normalizeAlbumTitleForGrouping('Title (Deluxe) (Japan Version)'), 'Title')
  })

  test('leaves a title with no edition-keyword parenthetical unchanged', () => {
    assert.equal(normalizeAlbumTitleForGrouping('Gangsta Bitch Music, Vol. 1'), 'Gangsta Bitch Music, Vol. 1')
  })

  test('does not strip a parenthetical with no edition keyword', () => {
    assert.equal(normalizeAlbumTitleForGrouping('Title (feat. Someone)'), 'Title (feat. Someone)')
  })

  test('strips "The Snow Mix" via the mix keyword', () => {
    assert.equal(normalizeAlbumTitleForGrouping('AM I THE DRAMA? (The Snow Mix)'), 'AM I THE DRAMA?')
  })

  test('is case-insensitive on the keyword match', () => {
    assert.equal(normalizeAlbumTitleForGrouping('Title (DELUXE EDITION)'), 'Title')
  })
})

describe('groupAlbumsForEditionMerge', () => {
  test('groups same-artist albums whose normalized titles match; earliest release date becomes primary', () => {
    const groups = groupAlbumsForEditionMerge([
      { id: 'a1', artistId: 'art1', title: 'AM I THE DRAMA?', releaseDate: '2025-09-19', albumType: 'Album' },
      { id: 'a2', artistId: 'art1', title: 'AM I THE DRAMA?', releaseDate: '2025-09-18', albumType: 'Album' },
      { id: 'a3', artistId: 'art1', title: 'AM I THE DRAMA? (Bonus Edition)', releaseDate: '2025-09-22', albumType: 'Album' },
    ])
    assert.equal(groups.length, 1)
    assert.equal(groups[0].primaryId, 'a2')
    assert.deepEqual(groups[0].editionIds.sort(), ['a1', 'a3'])
  })

  test('does not group distinct works with different normalized titles (Vol. 1 vs Vol. 2)', () => {
    const groups = groupAlbumsForEditionMerge([
      { id: 'b1', artistId: 'art2', title: 'Gangsta Bitch Music, Vol. 1', releaseDate: '2016-03-07', albumType: 'Album' },
      { id: 'b2', artistId: 'art2', title: 'Gangsta Bitch Music, Vol. 2', releaseDate: '2017-01-20', albumType: 'Album' },
    ])
    assert.equal(groups.length, 0)
  })

  test('does not group albums from different artists even with the same title', () => {
    const groups = groupAlbumsForEditionMerge([
      { id: 'c1', artistId: 'artX', title: 'Greatest Hits', releaseDate: '2020-01-01', albumType: 'Album' },
      { id: 'c2', artistId: 'artY', title: 'Greatest Hits', releaseDate: '2020-01-01', albumType: 'Album' },
    ])
    assert.equal(groups.length, 0)
  })

  test('ignores Single album_type even with matching titles', () => {
    const groups = groupAlbumsForEditionMerge([
      { id: 'd1', artistId: 'art3', title: 'Bongos', releaseDate: '2023-09-08', albumType: 'Single' },
      { id: 'd2', artistId: 'art3', title: 'Bongos (Radio Edit)', releaseDate: '2023-09-07', albumType: 'Single' },
    ])
    assert.equal(groups.length, 0)
  })

  test('produces no group for a lone ungrouped album', () => {
    const groups = groupAlbumsForEditionMerge([
      { id: 'e1', artistId: 'art4', title: 'Solo Album', releaseDate: '2019-01-01', albumType: 'Album' },
    ])
    assert.equal(groups.length, 0)
  })

  test('sorts a null release_date last when picking the primary', () => {
    const groups = groupAlbumsForEditionMerge([
      { id: 'f1', artistId: 'art5', title: 'Untitled', releaseDate: null, albumType: 'Album' },
      { id: 'f2', artistId: 'art5', title: 'Untitled (Deluxe)', releaseDate: '2022-01-01', albumType: 'Album' },
    ])
    assert.equal(groups.length, 1)
    assert.equal(groups[0].primaryId, 'f2')
  })
})
