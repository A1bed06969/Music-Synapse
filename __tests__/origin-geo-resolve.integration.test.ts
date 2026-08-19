// __tests__/origin-geo-resolve.integration.test.ts
//
// 実際のGSI/Nominatim APIを叩いて、既知の座標が期待通りのコードに解決されるかを
// 確認する結合テスト。ネットワークが必要。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { fetchCountryAndRegion, fetchMuniCode } from '../utils/originGeoResolve.ts'

describe('fetchCountryAndRegion (live Nominatim API)', () => {
  test('resolves Los Angeles City Hall to US / US-CA', async () => {
    const result = await fetchCountryAndRegion(34.0537, -118.2427)
    assert.equal(result.countryCode, 'us')
    assert.equal(result.regionCode, 'US-CA')
  })

  test('resolves central London to GB / GB-ENG', async () => {
    const result = await fetchCountryAndRegion(51.5074, -0.1278)
    assert.equal(result.countryCode, 'gb')
    assert.equal(result.regionCode, 'GB-ENG')
  })
})

describe('fetchMuniCode (live GSI API)', () => {
  test('resolves Tokyo Station area to muniCd 13101 (Chiyoda)', async () => {
    const muniCode = await fetchMuniCode(35.681167, 139.767052)
    assert.equal(muniCode, '13101')
  })
})
