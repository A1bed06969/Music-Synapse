// __tests__/artist-origin-boundary.unit.test.ts
//
// 「そのアーティストの塗りつぶし可能な最深レベルはどこか」を決める純粋関数の
// テスト。origin_region_code/origin_muni_codeが設定されていても、対応する
// geo_boundary行が無い場合(実データで確認済み: 英国・フランスの一部)は
// 一段階粗いレベルにフォールバックする、という挙動が本質。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { hasBoundaryDataForCountry, resolveArtistTarget, type BoundaryCodeSet } from '../utils/artistOriginBoundary.ts'

const CACHED: BoundaryCodeSet = {
  municipalityCodes: new Set(['13104']),
  regionCodes: new Set(['US-CA']),
}

describe('hasBoundaryDataForCountry', () => {
  test('true when at least one artist has a cached municipality code', () => {
    assert.equal(
      hasBoundaryDataForCountry([{ regionCode: null, muniCode: '13104' }], CACHED),
      true
    )
  })

  test('true when at least one artist has a cached region code', () => {
    assert.equal(
      hasBoundaryDataForCountry([{ regionCode: 'US-CA', muniCode: null }], CACHED),
      true
    )
  })

  test('false when the only codes present are not cached (the GB-ENG case)', () => {
    assert.equal(
      hasBoundaryDataForCountry([{ regionCode: 'GB-ENG', muniCode: null }], CACHED),
      false
    )
  })

  test('false for an empty artist list', () => {
    assert.equal(hasBoundaryDataForCountry([], CACHED), false)
  })
})

describe('resolveArtistTarget', () => {
  test('resolves to municipality when the muni code is cached', () => {
    const target = resolveArtistTarget({ countryCode: 'jp', regionCode: null, muniCode: '13104' }, CACHED)
    assert.deepEqual(target, { level: 'municipality', code: '13104' })
  })

  test('resolves to region when the region code is cached', () => {
    const target = resolveArtistTarget({ countryCode: 'us', regionCode: 'US-CA', muniCode: null }, CACHED)
    assert.deepEqual(target, { level: 'region', code: 'US-CA' })
  })

  test('falls back to country when the region code is set but not cached (GB-ENG case)', () => {
    const target = resolveArtistTarget({ countryCode: 'gb', regionCode: 'GB-ENG', muniCode: null }, CACHED)
    assert.deepEqual(target, { level: 'country', code: 'gb' })
  })

  test('falls back to country when there is a country code but no region/muni code at all', () => {
    const target = resolveArtistTarget({ countryCode: 'jm', regionCode: null, muniCode: null }, CACHED)
    assert.deepEqual(target, { level: 'country', code: 'jm' })
  })

  test('falls back to point when there is no country code either', () => {
    const target = resolveArtistTarget({ countryCode: null, regionCode: null, muniCode: null }, CACHED)
    assert.deepEqual(target, { level: 'point' })
  })
})
