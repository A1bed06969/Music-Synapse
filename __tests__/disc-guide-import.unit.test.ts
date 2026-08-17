// __tests__/disc-guide-import.unit.test.ts
//
// OCR抽出テキストの正規化・年号処理のユニットテスト。DB/サーバ不要、純粋関数のみ。
//
// 実行: npm test   (内部で `node --env-file-if-exists=.env.local --test __tests__/`)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOcrText, parseOCRToAlbums } from '../utils/discGuideImport.ts'

describe('normalizeOcrText', () => {
  test('collapses whitespace inserted between CJK characters', () => {
    assert.equal(normalizeOcrText('風 街 ろ まん'), '風街ろまん')
    assert.equal(normalizeOcrText('空中 キャ ンプ'), '空中キャンプ')
  })

  test('preserves spaces between Latin words', () => {
    assert.equal(normalizeOcrText('Solid State Survivor'), 'Solid State Survivor')
    assert.equal(normalizeOcrText('DJ Takemura & Kool Jazz'), 'DJ Takemura & Kool Jazz')
  })

  test('folds full-width digits and parentheses to half-width (NFKC)', () => {
    assert.equal(normalizeOcrText('（１９７９）'), '(1979)')
  })

  test('collapses repeated whitespace and trims', () => {
    assert.equal(normalizeOcrText('  Fishmans   Records  '), 'Fishmans Records')
  })

  test('returns empty string unchanged', () => {
    assert.equal(normalizeOcrText(''), '')
    assert.equal(normalizeOcrText('   '), '')
  })
})

describe('parseOCRToAlbums', () => {
  test('strips (YYYY) from the line so it does not end up in title/artist', async () => {
    const albums = await parseOCRToAlbums('YMO\nSolid State Survivor (1979)\nAlfa Records')
    assert.equal(albums.length, 1)
    assert.equal(albums[0].title, 'Solid State Survivor')
    assert.equal(albums[0].artist_name, 'YMO')
    assert.equal(albums[0].release_year, 1979)
  })

  test('strips a full-width year marker after NFKC normalization', async () => {
    const albums = await parseOCRToAlbums('Fishmans\n空中キャンプ（１９９６）\nPolydor')
    assert.equal(albums.length, 1)
    assert.equal(albums[0].title, '空中キャンプ')
    assert.equal(albums[0].release_year, 1996)
  })

  test('merges OCR-inserted spaces within a Japanese title before assignment', async () => {
    const albums = await parseOCRToAlbums('はっぴいえんど\n風 街 ろ まん (1971)\nURC')
    assert.equal(albums.length, 1)
    assert.equal(albums[0].title, '風街ろまん')
    assert.equal(albums[0].release_year, 1971)
  })

  test('handles multiple album entries in sequence (no label line)', async () => {
    // NOTE: a 3rd "label" line per entry (artist/title/label) is a pre-existing
    // heuristic limitation unrelated to this change — see disc-guide-import.integration
    // notes / Phase 1 report defect list. This test sticks to 2-line blocks so it
    // exercises only the year-stripping and normalization behavior added here.
    const albums = await parseOCRToAlbums(
      'DJ Takemura\nHoping For The Sun (1992)\nKool Jazz Productions\nPath Of Puppy (1993)'
    )
    assert.equal(albums.length, 2)
    assert.equal(albums[0].title, 'Hoping For The Sun')
    assert.equal(albums[0].release_year, 1992)
    assert.equal(albums[1].title, 'Path Of Puppy')
    assert.equal(albums[1].release_year, 1993)
  })
})
