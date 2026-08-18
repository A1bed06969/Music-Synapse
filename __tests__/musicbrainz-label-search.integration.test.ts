// __tests__/musicbrainz-label-search.integration.test.ts
//
// MusicBrainzのLabel検索APIを実際に叩き、レスポンス形式が想定通りであることを確認する。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { searchLabel } from '../utils/musicbrainz.ts'

describe('searchLabel', () => {
  test('finds Motown with founded year 1959', async () => {
    const results = await searchLabel('Motown')
    assert.ok(results.length > 0, 'expected at least one result')
    const motown = results.find((r) => r.name === 'Motown')
    assert.ok(motown, 'expected a result named exactly "Motown"')
    assert.equal(motown!.foundedYear, 1959)
    assert.equal(motown!.country, 'US')
  })

  test('returns empty array for a nonsense query', async () => {
    const results = await searchLabel('zzzznonexistentlabelxyz123')
    assert.deepEqual(results, [])
  })
})
