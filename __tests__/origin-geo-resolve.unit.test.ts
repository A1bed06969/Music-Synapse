// __tests__/origin-geo-resolve.unit.test.ts
//
// 逆ジオコーディングAPIのレスポンスから国/州地域/市区町村コードを取り出す
// 純粋関数のユニットテスト。DB/ネットワーク不要。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseNominatimAddress, parseGsiMuniCode } from '../utils/originGeoResolve.ts'

describe('parseNominatimAddress', () => {
  test('extracts country_code and ISO3166-2-lvl4 region code', () => {
    const result = parseNominatimAddress({ country_code: 'us', 'ISO3166-2-lvl4': 'US-CA' })
    assert.deepEqual(result, { countryCode: 'us', regionCode: 'US-CA' })
  })

  test('returns nulls when address is undefined', () => {
    assert.deepEqual(parseNominatimAddress(undefined), { countryCode: null, regionCode: null })
  })

  test('returns null regionCode when ISO3166-2-lvl4 is absent (country without subdivision data)', () => {
    const result = parseNominatimAddress({ country_code: 'mc' })
    assert.deepEqual(result, { countryCode: 'mc', regionCode: null })
  })
})

describe('parseGsiMuniCode', () => {
  test('extracts muniCd from a successful response', () => {
    assert.equal(parseGsiMuniCode({ results: { muniCd: '13101', lv01Nm: '丸の内一丁目' } }), '13101')
  })

  test('returns null when results is missing (point outside Japan)', () => {
    assert.equal(parseGsiMuniCode({}), null)
  })

  test('returns null when the whole response is undefined', () => {
    assert.equal(parseGsiMuniCode(undefined), null)
  })
})
