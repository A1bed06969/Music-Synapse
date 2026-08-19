// __tests__/artist-origin-map.unit.test.ts
//
// 大陸・国ごとのアーティスト集計ロジックの純粋関数テスト。
// 725KBの実ファイルではなく、小さな合成フィクスチャで検証する。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  buildCountryToContinentMap,
  groupArtistsByContinent,
  groupArtistsByCountry,
  type NaturalEarthCountryFeature,
} from '../utils/artistOriginMap.ts'

const FIXTURE_FEATURES: NaturalEarthCountryFeature[] = [
  { properties: { ISO_A2: 'JP', CONTINENT: 'Asia', ADMIN: 'Japan' }, geometry: {} },
  { properties: { ISO_A2: 'US', CONTINENT: 'North America', ADMIN: 'United States of America' }, geometry: {} },
  { properties: { ISO_A2: 'CA', CONTINENT: 'North America', ADMIN: 'Canada' }, geometry: {} },
  { properties: { ISO_A2: 'GB', CONTINENT: 'Europe', ADMIN: 'United Kingdom' }, geometry: {} },
  { properties: { ISO_A2: 'AQ', CONTINENT: 'Antarctica', ADMIN: 'Antarctica' }, geometry: {} },
]

describe('buildCountryToContinentMap', () => {
  test('maps lowercase ISO_A2 to a Japanese continent label', () => {
    const map = buildCountryToContinentMap(FIXTURE_FEATURES)
    assert.equal(map.get('jp'), 'アジア')
    assert.equal(map.get('us'), '北米')
    assert.equal(map.get('gb'), 'ヨーロッパ')
  })

  test('maps continents with no dedicated Japanese bucket (e.g. Antarctica) to その他', () => {
    const map = buildCountryToContinentMap(FIXTURE_FEATURES)
    assert.equal(map.get('aq'), 'その他')
  })

  test('skips features with no ISO_A2 or no CONTINENT', () => {
    const map = buildCountryToContinentMap([
      { properties: { CONTINENT: 'Asia' }, geometry: {} },
      { properties: { ISO_A2: 'ZZ' }, geometry: {} },
    ])
    assert.equal(map.size, 0)
  })
})

describe('groupArtistsByContinent', () => {
  test('counts artists per continent and sorts by CONTINENT_ORDER, omitting empty continents', () => {
    const countryToContinent = buildCountryToContinentMap(FIXTURE_FEATURES)
    const counts = groupArtistsByContinent(
      [{ countryCode: 'jp' }, { countryCode: 'jp' }, { countryCode: 'us' }, { countryCode: 'gb' }, { countryCode: 'ca' }],
      countryToContinent
    )
    assert.deepEqual(counts, [
      { continent: 'アジア', artistCount: 2 },
      { continent: 'ヨーロッパ', artistCount: 1 },
      { continent: '北米', artistCount: 2 },
    ])
  })

  test('ignores artists with no countryCode', () => {
    const countryToContinent = buildCountryToContinentMap(FIXTURE_FEATURES)
    const counts = groupArtistsByContinent([{ countryCode: null }, { countryCode: 'jp' }], countryToContinent)
    assert.deepEqual(counts, [{ continent: 'アジア', artistCount: 1 }])
  })
})

describe('buildCountryToContinentMap against the real committed asset', () => {
  test('resolves every real-world country actually used in production, including ISO_A2="-99" sentinel cases (France)', () => {
    const raw = readFileSync(path.join(process.cwd(), 'public/geo/world-countries.json'), 'utf-8')
    const worldCountries = JSON.parse(raw) as { features: NaturalEarthCountryFeature[] }
    const map = buildCountryToContinentMap(worldCountries.features)
    assert.equal(map.get('fr'), 'ヨーロッパ')
    assert.equal(map.get('jp'), 'アジア')
    assert.equal(map.get('us'), '北米')
    assert.equal(map.get('gb'), 'ヨーロッパ')
  })
})

describe('groupArtistsByCountry', () => {
  test('counts artists per country within one continent, sorted by count descending', () => {
    const countryToContinent = buildCountryToContinentMap(FIXTURE_FEATURES)
    const counts = groupArtistsByCountry(
      [{ countryCode: 'us' }, { countryCode: 'us' }, { countryCode: 'ca' }, { countryCode: 'jp' }],
      '北米',
      countryToContinent
    )
    assert.deepEqual(counts, [
      { countryCode: 'us', artistCount: 2 },
      { countryCode: 'ca', artistCount: 1 },
    ])
  })
})
