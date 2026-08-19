// __tests__/geo-boundary-cache.integration.test.ts
//
// geo_boundaryのget-or-fetchロジックを、実際のSupabaseプロジェクトと実際の
// 外部データソース(GitHub raw)に対して検証する結合テスト。
//
// 実行: npm test

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import {
  getOrFetchMunicipalityBoundary,
  fetchNaturalEarthAdmin1Features,
  getOrFetchRegionBoundary,
} from '../utils/geoBoundaryCache.ts'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const TEST_MUNI_CODE = '13101' // 千代田区
const TEST_REGION_CODE = 'US-CA'

// Task 4のバックフィルが既に実行済みの環境でテストを再実行すると、これらのコードは
// 本物のキャッシュ行として既に存在している可能性がある。誤って本物のキャッシュを
// 消さないよう、テスト実行前から存在していた行は削除しない。
let muniPreExisted = false
let regionPreExisted = false

before(async () => {
  const { data: muni } = await supabase
    .from('geo_boundary')
    .select('id')
    .eq('level', 'municipality')
    .eq('code', TEST_MUNI_CODE)
    .limit(1)
  muniPreExisted = (muni?.length ?? 0) > 0

  const { data: region } = await supabase
    .from('geo_boundary')
    .select('id')
    .eq('level', 'region')
    .eq('code', TEST_REGION_CODE)
    .limit(1)
  regionPreExisted = (region?.length ?? 0) > 0
})

after(async () => {
  if (!muniPreExisted) {
    await supabase.from('geo_boundary').delete().eq('level', 'municipality').eq('code', TEST_MUNI_CODE)
  }
  if (!regionPreExisted) {
    await supabase.from('geo_boundary').delete().eq('level', 'region').eq('code', TEST_REGION_CODE)
  }
})

describe('getOrFetchMunicipalityBoundary (live DB + live niiyz/JapanCityGeoJson)', () => {
  test('fetches, caches, and returns a MultiPolygon geometry for 千代田区(13101)', async () => {
    const geometry = await getOrFetchMunicipalityBoundary(supabase, TEST_MUNI_CODE)
    assert.ok(geometry)
    assert.equal((geometry as { type?: string }).type, 'MultiPolygon')

    const { data: cached } = await supabase
      .from('geo_boundary')
      .select('geometry')
      .eq('level', 'municipality')
      .eq('code', TEST_MUNI_CODE)
      .limit(1)
    assert.equal(cached?.length, 1)
  })
})

describe('getOrFetchRegionBoundary (live DB + Natural Earth admin-1)', () => {
  test('fetches, caches, and returns a geometry for California (US-CA)', async () => {
    const features = await fetchNaturalEarthAdmin1Features()
    assert.ok(features.length > 4000, `expected the full ~4,596-feature world dataset, got ${features.length}`)

    const geometry = await getOrFetchRegionBoundary(supabase, TEST_REGION_CODE, features)
    assert.ok(geometry)

    const { data: cached } = await supabase
      .from('geo_boundary')
      .select('geometry')
      .eq('level', 'region')
      .eq('code', TEST_REGION_CODE)
      .limit(1)
    assert.equal(cached?.length, 1)
  })

  test('returns null for a region code not present in the dataset', async () => {
    const geometry = await getOrFetchRegionBoundary(supabase, 'ZZ-NOPE', [])
    assert.equal(geometry, null)
  })
})
