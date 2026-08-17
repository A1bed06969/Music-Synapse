// __tests__/disc-guide-import.unit.test.ts
//
// OCR抽出テキストの正規化・年号処理のユニットテスト。DB/サーバ不要、純粋関数のみ。
//
// 実行: npm test   (内部で `node --env-file-if-exists=.env.local --test __tests__/`)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOcrText, parseOCRToAlbums, matchAlbumsWithCandidates } from '../utils/discGuideImport.ts'
import { createAdminClient } from '../utils/Supabase/admin.ts'

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

  test('handles multiple 2-line entries in sequence (year on title line)', async () => {
    const albums = await parseOCRToAlbums(
      'DJ Takemura\nHoping For The Sun (1992)\nKool Jazz Productions\nPath Of Puppy (1993)'
    )
    assert.equal(albums.length, 2)
    assert.equal(albums[0].title, 'Hoping For The Sun')
    assert.equal(albums[0].artist_name, 'DJ Takemura')
    assert.equal(albums[0].release_year, 1992)
    assert.equal(albums[1].title, 'Path Of Puppy')
    assert.equal(albums[1].artist_name, 'Kool Jazz Productions')
    assert.equal(albums[1].release_year, 1993)
  })

  test('handles multiple 3-line entries without the label bleeding into the next artist', async () => {
    // Real disc guide layout: artist / title / "label (year) format", i.e. the
    // year appears on the label line, not the title line. Previously the label
    // line ("Global Dept") was misread as the *next* entry's artist name,
    // shifting every subsequent entry by one line.
    const albums = await parseOCRToAlbums(
      'DJ Takemura & Kool Jazz Productions\n' +
        'Hoping For The Sun\n' +
        'Global Dept (1992) 12inch\n' +
        'Kool Jazz Productions\n' +
        'Path Of Puppy\n' +
        'Lollop (1993) 12inch'
    )
    assert.equal(albums.length, 2)
    assert.equal(albums[0].artist_name, 'DJ Takemura & Kool Jazz Productions')
    assert.equal(albums[0].title, 'Hoping For The Sun')
    assert.equal(albums[0].release_year, 1992)
    assert.match(albums[0].label ?? '', /Global Dept/)
    assert.equal(albums[1].artist_name, 'Kool Jazz Productions')
    assert.equal(albums[1].title, 'Path Of Puppy')
    assert.equal(albums[1].release_year, 1993)
    assert.match(albums[1].label ?? '', /Lollop/)
  })

  test('finalizes a 3-line entry with no year at all instead of dropping it', async () => {
    const albums = await parseOCRToAlbums('Artist\nTitle\nSome Label')
    assert.equal(albums.length, 1)
    assert.equal(albums[0].artist_name, 'Artist')
    assert.equal(albums[0].title, 'Title')
    assert.equal(albums[0].label, 'Some Label')
    assert.equal(albums[0].release_year, undefined)
  })
})

// matchAlbumsWithCandidates はDB(search_albums_fuzzy RPC)を叩くため、
// dev serverは不要だがSupabase接続が必要。Phase 1レポートで実測した
// 「ilikeの完全部分一致だと0件になる」3パターンが、pg_trgmファジー検索に
// 切り替えたことで候補に出てくることを確認する。
describe('matchAlbumsWithCandidates (live DB, pg_trgm fuzzy search)', () => {
  test('surfaces "The Vertigo of Bliss" despite an injected space and a wrong character', async () => {
    const supabase = createAdminClient()
    const { data: existing } = await supabase
      .from('album')
      .select('id')
      .eq('title', 'The Vertigo of Bliss')
      .limit(1)
      .maybeSingle()
    if (!existing) {
      console.warn('[unit] "The Vertigo of Bliss" not found in DB; skipping fuzzy-match assertions')
      return
    }

    const cases = [
      { title: 'The Vertigo of Bliss (2003)', artist_name: 'Biffy Clyro' }, // 年号除去前と同じ入力
      { title: 'The Vertigo of Bl iss', artist_name: 'Biffy Clyro' }, // 空白混入
      { title: 'The Vertigo of Blise', artist_name: 'Biffy Clyro' }, // 1文字誤読
    ]

    const results = await matchAlbumsWithCandidates(supabase, cases)
    for (const [i, r] of results.entries()) {
      assert.ok(
        r.candidates.some((c) => c.title === 'The Vertigo of Bliss'),
        `case ${i} (${JSON.stringify(cases[i])}) should surface "The Vertigo of Bliss" as a candidate, got: ${JSON.stringify(r.candidates)}`
      )
    }
  })
})
