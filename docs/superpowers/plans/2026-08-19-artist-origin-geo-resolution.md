# Artist Origin Geo Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve each geocoded artist's origin coordinates into a Japan municipality code, or a world country/region (ISO 3166-2) code, and cache the corresponding boundary polygon — the data layer the artist-origin map redesign will render on top of.

**Architecture:** A one-time backfill script calls two free reverse-geocoding APIs (GSI for Japan municipalities, Nominatim for country/region codes worldwide) per artist and writes the resolved codes onto `artist`. A second helper module fetches boundary polygons (from `niiyz/JapanCityGeoJson` for Japan, from the official Natural Earth GitHub repo for the rest of the world) on first use and caches them in a new `geo_boundary` table, so the (not-yet-built) map UI never has to hit an external API at request time.

**Tech Stack:** Next.js/TypeScript, Supabase (Postgres), `node --test` for unit/integration tests, `tsx` for the backfill script (matching `scripts/backfill-artist-hometown-country.ts`).

**Spec:** docs/superpowers/specs/2026-08-19-artist-origin-map-design.md

**Scope note:** The spec's UI drill-down (world → continent → country → region/municipality rendering in `/map`) is intentionally **not** part of this plan. This plan only builds and populates the data layer (`origin_country_code`/`origin_region_code`/`origin_muni_code` columns and the `geo_boundary` cache) so it can be independently verified via SQL before any UI work starts. The map UI rework will be a separate follow-up plan once this one has landed and the backfill has run.

## Global Constraints

- All external data sources are free and require no API key: GSI reverse geocoder (`mreversegeocoder.gsi.go.jp`), Nominatim (`nominatim.openstreetmap.org`), `niiyz/JapanCityGeoJson` (GitHub raw), `nvkelso/natural-earth-vector` (GitHub raw, official Natural Earth repo). Do not substitute any paid geocoding/mapping API.
- Nominatim usage policy: max ~1 request/second, must send an identifying `User-Agent` header. Follow the exact pattern already used in `scripts/backfill-artist-hometown-country.ts`.
- Must use the **10m** resolution file for Natural Earth admin-1 (`geojson/ne_10m_admin_1_states_provinces.geojson`) — the 50m/110m files in the same repo were verified to only cover ~4 countries, not the whole world.
- Natural Earth admin-0 (`geojson/ne_110m_admin_0_countries.geojson`) uses **uppercase** property keys (`ISO_A2`, `CONTINENT`); admin-1 (`geojson/ne_10m_admin_1_states_provinces.geojson`) uses **lowercase** property keys (`iso_a2`, `iso_3166_2`, `name`, `admin`). Do not assume they match.
- Existing columns (`origin_latitude`, `origin_longitude`, `origin_prefecture`, `hometown_city`, `hometown_country`) are untouched — this plan only adds new columns/tables alongside them.
- New DB objects follow existing conventions: `id text primary key default generate_ms_id('XXX')`, RLS enabled with a public read policy, service_role bypasses RLS for writes (see `supabase/migrations/20260819_create_tie_up.sql` for the exact pattern).
- Backfill script goes in `scripts/` (not the repo root) and is committed, matching `scripts/backfill-artist-hometown-country.ts` — this repo's convention for one-off scripts meant to stay in history (as opposed to the ad-hoc uncommitted `tmp-backfill-*.ts` scripts used earlier this session).

---

### Task 1: Migration — origin geo columns and `geo_boundary` table

**Files:**
- Create: `supabase/migrations/20260819_add_artist_origin_geo_codes.sql`

**Interfaces:**
- Produces: `artist.origin_country_code` (text, nullable), `artist.origin_region_code` (text, nullable), `artist.origin_muni_code` (text, nullable); table `geo_boundary(id, level, code, name, geometry, created_at)` with `UNIQUE(level, code)`.

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/20260819_add_artist_origin_geo_codes.sql
-- アーティスト出身地マップのドリルダウン表示(塗りつぶし)のための下準備。
-- origin_latitude/longitudeを逆ジオコーディングして得た、日本の市区町村コード・
-- 世界の国/州地域コードを保持する。既存のorigin_prefecture/hometown_city/
-- hometown_countryは自由入力のまま残し、このカラムは地図描画専用の
-- 構造化コードとして独立させる。
ALTER TABLE artist
  ADD COLUMN origin_country_code TEXT,
  ADD COLUMN origin_region_code TEXT,
  ADD COLUMN origin_muni_code TEXT;

-- 市区町村(日本)・州地域(世界)の境界ポリゴンのキャッシュ。実際にアーティストが
-- 割り当てられた分だけ、参照時に外部データソースから取得して保存する
-- (全世界の行政区画を先読みしない)。
CREATE TABLE geo_boundary (
  id TEXT PRIMARY KEY DEFAULT generate_ms_id('GEB'::text),
  level TEXT NOT NULL CHECK (level IN ('municipality', 'region')),
  code TEXT NOT NULL,
  name TEXT,
  geometry JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (level, code)
);

ALTER TABLE geo_boundary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON geo_boundary FOR SELECT TO public USING (true);
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use the `mcp__claude_ai_Supabase__apply_migration` tool with `project_id: ftvhglfthbcxhgnoninv`, `name: add_artist_origin_geo_codes`, and the SQL body above (this project applies migrations via MCP rather than a local Supabase CLI — follow the pattern used by every other `supabase/migrations/*.sql` file in this repo, which are applied via MCP and then saved to the repo for the record).

- [ ] **Step 3: Verify via SQL**

Run via `mcp__claude_ai_Supabase__execute_sql` (`project_id: ftvhglfthbcxhgnoninv`):

```sql
select column_name from information_schema.columns
where table_name = 'artist' and column_name like 'origin_%code';

select count(*) from geo_boundary;
```

Expected: first query returns `origin_country_code`, `origin_region_code`, `origin_muni_code`; second returns `0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260819_add_artist_origin_geo_codes.sql
git commit -m "feat: add artist origin geo code columns and geo_boundary cache table"
```

---

### Task 2: Reverse-geocoding resolution (`utils/originGeoResolve.ts`)

**Files:**
- Create: `utils/originGeoResolve.ts`
- Test: `__tests__/origin-geo-resolve.unit.test.ts`
- Test: `__tests__/origin-geo-resolve.integration.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (for Task 4 to consume):
  - `type ResolvedCountryRegion = { countryCode: string | null; regionCode: string | null }`
  - `parseNominatimAddress(address: NominatimAddress | undefined): ResolvedCountryRegion`
  - `fetchCountryAndRegion(lat: number, lon: number): Promise<ResolvedCountryRegion>`
  - `parseGsiMuniCode(data: GsiReverseGeocoderResult | undefined): string | null`
  - `fetchMuniCode(lat: number, lon: number): Promise<string | null>`

- [ ] **Step 1: Write the failing unit tests for the pure parse functions**

```typescript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern "parseNominatimAddress|parseGsiMuniCode"`
Expected: FAIL — `../utils/originGeoResolve.ts` does not exist yet.

- [ ] **Step 3: Implement `utils/originGeoResolve.ts`**

```typescript
// utils/originGeoResolve.ts
//
// アーティストの出身地座標(origin_latitude/longitude)を、地図の塗りつぶし表示用の
// 構造化コードへ解決する。国土地理院(GSI)は日本国内の市区町村コード専用、
// Nominatimは国コード・ISO 3166-2の州地域コードを世界共通で返す。

const NOMINATIM_USER_AGENT = 'MusicSynapse-Dev/1.0 (personal project, origin geo code backfill)'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type NominatimAddress = {
  country_code?: string
  'ISO3166-2-lvl4'?: string
}

export type ResolvedCountryRegion = {
  countryCode: string | null
  regionCode: string | null
}

export function parseNominatimAddress(address: NominatimAddress | undefined): ResolvedCountryRegion {
  if (!address) return { countryCode: null, regionCode: null }
  return {
    countryCode: address.country_code ?? null,
    regionCode: address['ISO3166-2-lvl4'] ?? null,
  }
}

export async function fetchCountryAndRegion(lat: number, lon: number): Promise<ResolvedCountryRegion> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&addressdetails=1`
  const res = await fetch(url, {
    headers: { 'User-Agent': NOMINATIM_USER_AGENT },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    throw new Error(`Nominatim API error: ${res.status}`)
  }
  const data = (await res.json()) as { address?: NominatimAddress }
  return parseNominatimAddress(data.address)
}

export type GsiReverseGeocoderResult = {
  results?: { muniCd?: string; lv01Nm?: string }
}

export function parseGsiMuniCode(data: GsiReverseGeocoderResult | undefined): string | null {
  return data?.results?.muniCd ?? null
}

export async function fetchMuniCode(lat: number, lon: number): Promise<string | null> {
  const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lon=${lon}&lat=${lat}`
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) {
    throw new Error(`GSI API error: ${res.status}`)
  }
  const data = (await res.json()) as GsiReverseGeocoderResult
  return parseGsiMuniCode(data)
}

export { sleep as sleepForRateLimit }
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npm test -- --test-name-pattern "parseNominatimAddress|parseGsiMuniCode"`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the live-API integration tests**

```typescript
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
```

- [ ] **Step 6: Run the integration tests to verify they pass**

Run: `npm test -- --test-name-pattern "live Nominatim API|live GSI API"`
Expected: PASS (3 tests). If Nominatim rate-limits (HTTP 429), rerun after a short wait — this is expected occasionally when running the whole suite back-to-back with other integration tests.

- [ ] **Step 7: Commit**

```bash
git add utils/originGeoResolve.ts __tests__/origin-geo-resolve.unit.test.ts __tests__/origin-geo-resolve.integration.test.ts
git commit -m "feat: add GSI/Nominatim reverse-geocoding resolution for artist origin"
```

---

### Task 3: Boundary polygon caching (`utils/geoBoundaryCache.ts`)

**Files:**
- Create: `utils/geoBoundaryCache.ts`
- Test: `__tests__/geo-boundary-cache.integration.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks directly (independent module), but assumes the `geo_boundary` table from Task 1 exists.
- Produces (for Task 4 to consume):
  - `type GeoBoundaryGeometry = Record<string, unknown>`
  - `type NaturalEarthAdmin1Feature = { properties: { iso_3166_2?: string; name?: string }; geometry: GeoBoundaryGeometry }`
  - `getOrFetchMunicipalityBoundary(supabase: SupabaseClient, muniCode: string): Promise<GeoBoundaryGeometry | null>`
  - `fetchNaturalEarthAdmin1Features(): Promise<NaturalEarthAdmin1Feature[]>`
  - `getOrFetchRegionBoundary(supabase: SupabaseClient, regionCode: string, preloadedFeatures: NaturalEarthAdmin1Feature[]): Promise<GeoBoundaryGeometry | null>`

- [ ] **Step 1: Implement `utils/geoBoundaryCache.ts`**

This task's tests hit live external services (GitHub raw + the real Supabase project), matching the existing convention in `__tests__/musicbrainz-label-search.integration.test.ts` and `__tests__/label-timeline.unit.test.ts`'s sibling integration file — there is no pure-logic split here worth unit-testing separately, since the whole function body is "check cache, else fetch, else insert."

```typescript
// utils/geoBoundaryCache.ts
//
// 市区町村(日本)・州地域(世界)の境界ポリゴンを、DB(geo_boundary)にキャッシュしつつ
// 取得する。無いものだけ都度、外部の無料公開データから取得する。

import type { SupabaseClient } from '@supabase/supabase-js'

const NIIYZ_BASE_URL = 'https://raw.githubusercontent.com/niiyz/JapanCityGeoJson/master/geojson'
// 同リポジトリの50m/110m版はなぜか世界の一部の国(実測で4ヶ国・294件)しか
// 収録されておらず、必ず10m版(4,596件・253国地域、実測で確認済み)を使うこと。
const NATURAL_EARTH_ADMIN1_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson'

export type GeoBoundaryGeometry = Record<string, unknown>

type NiiyzMunicipalityResponse = {
  features?: { properties?: { N03_004?: string }; geometry?: GeoBoundaryGeometry }[]
}

export async function getOrFetchMunicipalityBoundary(
  supabase: SupabaseClient,
  muniCode: string
): Promise<GeoBoundaryGeometry | null> {
  const { data: existing } = await supabase
    .from('geo_boundary')
    .select('geometry')
    .eq('level', 'municipality')
    .eq('code', muniCode)
    .limit(1)
  if (existing && existing.length > 0) return existing[0].geometry as GeoBoundaryGeometry

  const prefectureCode = muniCode.slice(0, 2)
  const url = `${NIIYZ_BASE_URL}/${prefectureCode}/${muniCode}.json`
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) return null

  const data = (await res.json()) as NiiyzMunicipalityResponse
  const feature = data.features?.[0]
  if (!feature?.geometry) return null

  await supabase.from('geo_boundary').insert({
    level: 'municipality',
    code: muniCode,
    name: feature.properties?.N03_004 ?? null,
    geometry: feature.geometry,
  })

  return feature.geometry
}

export type NaturalEarthAdmin1Feature = {
  properties: { iso_3166_2?: string; name?: string }
  geometry: GeoBoundaryGeometry
}

export async function fetchNaturalEarthAdmin1Features(): Promise<NaturalEarthAdmin1Feature[]> {
  const res = await fetch(NATURAL_EARTH_ADMIN1_URL, { signal: AbortSignal.timeout(120000) })
  if (!res.ok) {
    throw new Error(`Natural Earth admin-1 fetch error: ${res.status}`)
  }
  const data = (await res.json()) as { features?: NaturalEarthAdmin1Feature[] }
  return data.features ?? []
}

export async function getOrFetchRegionBoundary(
  supabase: SupabaseClient,
  regionCode: string,
  preloadedFeatures: NaturalEarthAdmin1Feature[]
): Promise<GeoBoundaryGeometry | null> {
  const { data: existing } = await supabase
    .from('geo_boundary')
    .select('geometry')
    .eq('level', 'region')
    .eq('code', regionCode)
    .limit(1)
  if (existing && existing.length > 0) return existing[0].geometry as GeoBoundaryGeometry

  const feature = preloadedFeatures.find((f) => f.properties.iso_3166_2 === regionCode)
  if (!feature) return null

  await supabase.from('geo_boundary').insert({
    level: 'region',
    code: regionCode,
    name: feature.properties.name ?? null,
    geometry: feature.geometry,
  })

  return feature.geometry
}
```

- [ ] **Step 2: Write the integration tests**

These tests hit the real Supabase project and real GitHub-hosted data, and clean up after themselves so the test is repeatable.

```typescript
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
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern "getOrFetchMunicipalityBoundary|getOrFetchRegionBoundary"`
Expected: PASS (3 tests). The Natural Earth fetch is ~40MB so this test will take longer than the others (allow up to ~30-60s).

- [ ] **Step 4: Commit**

```bash
git add utils/geoBoundaryCache.ts __tests__/geo-boundary-cache.integration.test.ts
git commit -m "feat: add municipality/region boundary polygon caching"
```

---

### Task 4: Backfill script

**Files:**
- Create: `scripts/backfill-artist-origin-geo-codes.ts`

**Interfaces:**
- Consumes: `fetchCountryAndRegion`, `fetchMuniCode` from `utils/originGeoResolve.ts` (Task 2); `getOrFetchMunicipalityBoundary`, `fetchNaturalEarthAdmin1Features`, `getOrFetchRegionBoundary` from `utils/geoBoundaryCache.ts` (Task 3); `createAdminClient` from `utils/Supabase/admin.ts` (existing).
- Produces: nothing consumed by other tasks in this plan — this is the plan's end deliverable, run manually.

- [ ] **Step 1: Implement the script**

```typescript
// scripts/backfill-artist-origin-geo-codes.ts
/**
 * アーティスト出身地マップの塗りつぶし表示のための下準備。
 * origin_latitude/longitudeが登録済みでorigin_country_codeが未設定のアーティストに
 * ついて、Nominatimで国コード・州地域コード(ISO3166-2)を、日本国内なら国土地理院APIで
 * 市区町村コードも解決してartistテーブルに保存する。同時に、該当する市区町村/州地域の
 * 境界ポリゴンをgeo_boundaryにキャッシュする。
 *
 * Nominatim/GSIともに利用ポリシーに配慮し、リクエスト間隔を1秒空ける。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/backfill-artist-origin-geo-codes.ts
 */
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchCountryAndRegion, fetchMuniCode } from '@/utils/originGeoResolve'
import {
  getOrFetchMunicipalityBoundary,
  getOrFetchRegionBoundary,
  fetchNaturalEarthAdmin1Features,
  type NaturalEarthAdmin1Feature,
} from '@/utils/geoBoundaryCache'

const REQUEST_INTERVAL_MS = 1000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type ArtistRow = { id: string; name: string; origin_latitude: number; origin_longitude: number }

async function resolveJapaneseArtist(
  supabase: ReturnType<typeof createAdminClient>,
  artist: ArtistRow,
  countryCode: string
) {
  const muniCode = await fetchMuniCode(artist.origin_latitude, artist.origin_longitude)
  await sleep(REQUEST_INTERVAL_MS)

  await supabase.from('artist').update({ origin_country_code: countryCode, origin_muni_code: muniCode }).eq('id', artist.id)

  if (!muniCode) {
    console.log('  日本 / 市区町村コード取得できず')
    return
  }
  const boundary = await getOrFetchMunicipalityBoundary(supabase, muniCode)
  console.log(`  日本 / muniCd=${muniCode}${boundary ? '' : '(境界ポリゴン取得失敗)'}`)
}

async function resolveOtherArtist(
  supabase: ReturnType<typeof createAdminClient>,
  artist: ArtistRow,
  countryCode: string,
  regionCode: string | null,
  admin1Features: NaturalEarthAdmin1Feature[]
) {
  await supabase.from('artist').update({ origin_country_code: countryCode, origin_region_code: regionCode }).eq('id', artist.id)

  if (!regionCode) {
    console.log(`  ${countryCode} / 州地域コード無し(国ブロック表示にフォールバック)`)
    return
  }
  const boundary = await getOrFetchRegionBoundary(supabase, regionCode, admin1Features)
  console.log(`  ${countryCode} / region=${regionCode}${boundary ? '' : '(境界ポリゴン取得失敗)'}`)
}

async function main() {
  const supabase = createAdminClient()

  const { data: artists, error } = await supabase
    .from('artist')
    .select('id, name, origin_latitude, origin_longitude')
    .not('origin_latitude', 'is', null)
    .not('origin_longitude', 'is', null)
    .is('origin_country_code', null)

  if (error) {
    console.error('アーティスト取得に失敗しました:', error.message)
    process.exit(1)
  }

  const rows = (artists ?? []) as ArtistRow[]
  if (rows.length === 0) {
    console.log('対象のアーティストはいません。')
    return
  }
  console.log(`対象: ${rows.length}件\n`)

  console.log('Natural Earthの州・地域データを取得中(約40MB、数十秒かかります)...')
  const admin1Features = await fetchNaturalEarthAdmin1Features()
  console.log(`取得完了: ${admin1Features.length}件\n`)

  for (const [index, artist] of rows.entries()) {
    console.log(`[${index + 1}/${rows.length}] ${artist.name}`)
    try {
      const { countryCode, regionCode } = await fetchCountryAndRegion(artist.origin_latitude, artist.origin_longitude)
      await sleep(REQUEST_INTERVAL_MS)

      if (!countryCode) {
        console.log('  国コードを取得できませんでした')
        continue
      }

      if (countryCode === 'jp') {
        await resolveJapaneseArtist(supabase, artist, countryCode)
      } else {
        await resolveOtherArtist(supabase, artist, countryCode, regionCode, admin1Features)
      }
    } catch (err) {
      console.error(`  失敗: ${err instanceof Error ? err.message : err}`)
    }
  }

  console.log('\nDONE')
}

main()
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Run against the real database and verify with real data**

```bash
npx tsx --env-file=.env.local scripts/backfill-artist-origin-geo-codes.ts
```

Let it run to completion (it will process every artist that has `origin_latitude`/`origin_longitude` set — expect it to take a while due to the 1 req/sec rate limiting on both APIs, plus the one-time ~40MB Natural Earth download).

Then verify via `mcp__claude_ai_Supabase__execute_sql` (`project_id: ftvhglfthbcxhgnoninv`):

```sql
select origin_country_code, count(*) from artist where origin_country_code is not null group by 1 order by 2 desc;
select count(*) from artist where origin_country_code = 'jp' and origin_muni_code is not null;
select level, count(*) from geo_boundary group by 1;
```

Expected: at least one `jp` row with a populated `origin_muni_code`, at least one non-`jp` country with `origin_region_code` set (e.g. `us`/`US-CA`, if any US-origin artist has coordinates), and `geo_boundary` containing rows at both `municipality` and `region` levels matching those codes.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-artist-origin-geo-codes.ts
git commit -m "feat: add one-time backfill script for artist origin geo codes"
```

---

## After this plan lands

Once the backfill has run and the SQL verification in Task 4 Step 3 confirms real `origin_country_code`/`origin_region_code`/`origin_muni_code`/`geo_boundary` data exists, write a follow-up plan for the `/map` UI drill-down (world → continent → country → region/municipality rendering in `app/map/page.tsx`, `TabbedMapView.tsx`, `LeafletMap.tsx`), per the spec's "UI状態遷移" and "レンダリング方式" sections. That UI plan can then build and test against real cached boundary data instead of guessing at shapes.
