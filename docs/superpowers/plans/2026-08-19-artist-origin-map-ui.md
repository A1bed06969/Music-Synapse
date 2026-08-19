# Artist Origin Map UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the artist tab's point-marker map on `/map` with a continent → country → region/municipality choropleth drill-down, using the `origin_country_code`/`origin_region_code`/`origin_muni_code` columns and `geo_boundary` cache that the (already-shipped) data-layer plan populated.

**Architecture:** Two new pure, unit-tested utility modules do all the grouping/decision logic (continent/country aggregation from a static world-countries GeoJSON; per-artist target-level resolution against the cached boundary codes). A new API route serves `geo_boundary` polygons on demand, scoped to only the codes actually needed (never the whole table). `LeafletMap.tsx` gains an optional `polygons` prop so it can render GeoJSON fills alongside its existing point markers. A new client component, `ArtistOriginMap.tsx`, owns the 3-level drill-down state machine and is wired into the artist tab in place of the old marker-only rendering; venue/shop tabs are untouched.

**Tech Stack:** Next.js/TypeScript (App Router, Server Components), Supabase (Postgres), Leaflet (vanilla `leaflet` package, not react-leaflet), `node --test`.

**Spec:** docs/superpowers/specs/2026-08-19-artist-origin-map-design.md (UI状態遷移・レンダリング方式 sections — the データモデル/データソース/解決ロジック sections were implemented by docs/superpowers/plans/2026-08-19-artist-origin-geo-resolution.md, already shipped and live)

## Global Constraints

- The data layer this plan builds on is already live in production: `artist.origin_country_code`/`origin_region_code`/`origin_muni_code` (nullable text) and `geo_boundary(id, level, code, name, geometry, created_at)` with `UNIQUE(level, code)`. `origin_region_code`/`origin_muni_code` being non-null does **not** guarantee a matching `geo_boundary` row exists (verified in production: 49 UK/France artists have a region code with no cached polygon, a permanent Natural Earth data-source gap) — always check for a matching `geo_boundary` row before assuming a polygon is renderable, never assume from the code's presence alone.
- `geo_boundary.geometry` rows are large (tens of KB to ~600KB each). Never `select *` or `select geometry` from `geo_boundary` for more than the specific codes currently needed on screen.
- venue/shop map tabs are out of scope — they keep their current point-marker rendering in `LeafletMap.tsx` unchanged.
- All data sources are already fetched/cached from earlier plan; this plan additionally needs one static asset: the world country boundaries (`ne_110m_admin_0_countries.geojson` from the official `nvkelso/natural-earth-vector` GitHub repo, public domain, ~725KB) — bundled as a static file in `public/`, not fetched at request time.
- Natural Earth admin-0 country properties use **uppercase** keys: `ISO_A2` (2-letter country code), `CONTINENT` (English continent name), `ADMIN` (country display name).
- Follow the existing `MapMarker`/`LeafletMap` conventions already in the codebase (`app/map/LeafletMap.tsx`, `app/map/TabbedMapView.tsx`, `app/map/page.tsx`) rather than introducing a new mapping abstraction — extend, don't replace.
- No paid APIs or services. Everything in this plan is either already-cached DB data or a static bundled asset.

---

### Task 1: World country boundaries asset + continent/country aggregation (`utils/artistOriginMap.ts`)

**Files:**
- Create: `public/geo/world-countries.json`
- Create: `utils/artistOriginMap.ts`
- Test: `__tests__/artist-origin-map.unit.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (for Task 5 to consume):
  - `type NaturalEarthCountryFeature = { properties: { ISO_A2?: string; CONTINENT?: string; ADMIN?: string }; geometry: Record<string, unknown> }`
  - `CONTINENT_ORDER: readonly string[]`
  - `CONTINENT_CENTER: Record<string, [number, number]>`
  - `buildCountryToContinentMap(features: NaturalEarthCountryFeature[]): Map<string, string>`
  - `groupArtistsByContinent(artists: { countryCode: string | null }[], countryToContinent: Map<string, string>): { continent: string; artistCount: number }[]`
  - `groupArtistsByCountry(artists: { countryCode: string | null }[], continent: string, countryToContinent: Map<string, string>): { countryCode: string; artistCount: number }[]`

- [ ] **Step 1: Fetch and commit the static world-countries asset**

```bash
mkdir -p public/geo
curl -s "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson" -o public/geo/world-countries.json
```

Verify it downloaded correctly:

```bash
python3 -c "
import json
d = json.load(open('public/geo/world-countries.json'))
print('features:', len(d['features']))
print('sample keys:', sorted(d['features'][0]['properties'].keys())[:5])
"
```

Expected: `features: 177` (this exact count was verified during the data-layer plan). If the count differs significantly, stop and report — the source may have changed or the download may be truncated.

- [ ] **Step 2: Write the failing unit test**

```typescript
// __tests__/artist-origin-map.unit.test.ts
//
// 大陸・国ごとのアーティスト集計ロジックの純粋関数テスト。
// 725KBの実ファイルではなく、小さな合成フィクスチャで検証する。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern "buildCountryToContinentMap|groupArtistsByContinent|groupArtistsByCountry"`
Expected: FAIL — `../utils/artistOriginMap.ts` does not exist yet.

- [ ] **Step 4: Implement `utils/artistOriginMap.ts`**

```typescript
// utils/artistOriginMap.ts
//
// アーティスト出身地マップの大陸/国レベルの集計ロジック。世界の国境データ
// (Natural Earth admin-0, public/geo/world-countries.json)のCONTINENT属性を
// そのまま使うことで、既存のutils/continents.ts(自由入力の国名文字列ベースで
// カバレッジに漏れがある)には依存しない、コード起点の頑健な大陸判定を行う。

export type NaturalEarthCountryFeature = {
  properties: { ISO_A2?: string; CONTINENT?: string; ADMIN?: string }
  geometry: Record<string, unknown>
}

export const CONTINENT_ORDER = ['アジア', 'ヨーロッパ', '北米', '南米', 'オセアニア', 'アフリカ', 'その他'] as const

const CONTINENT_LABEL_JA: Record<string, string> = {
  Asia: 'アジア',
  Europe: 'ヨーロッパ',
  'North America': '北米',
  'South America': '南米',
  Oceania: 'オセアニア',
  Africa: 'アフリカ',
}

/** 大陸ラベルの目安表示位置(世界地図初期表示でのマーカー位置)。緯度経度は
 * 各大陸のおおよその重心を手動で決めた値(実装時に妥当な値を決める、という
 * 元設計の申し送り事項への対応)。 */
export const CONTINENT_CENTER: Record<string, [number, number]> = {
  アジア: [34, 100],
  ヨーロッパ: [54, 15],
  北米: [45, -100],
  南米: [-15, -60],
  オセアニア: [-25, 140],
  アフリカ: [2, 20],
}

export function buildCountryToContinentMap(features: NaturalEarthCountryFeature[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const feature of features) {
    const iso = feature.properties.ISO_A2?.toLowerCase()
    const continent = feature.properties.CONTINENT
    if (!iso || !continent) continue
    map.set(iso, CONTINENT_LABEL_JA[continent] ?? 'その他')
  }
  return map
}

export type ContinentCount = { continent: string; artistCount: number }

export function groupArtistsByContinent(
  artists: { countryCode: string | null }[],
  countryToContinent: Map<string, string>
): ContinentCount[] {
  const counts = new Map<string, number>()
  for (const artist of artists) {
    if (!artist.countryCode) continue
    const continent = countryToContinent.get(artist.countryCode.toLowerCase()) ?? 'その他'
    counts.set(continent, (counts.get(continent) ?? 0) + 1)
  }
  return CONTINENT_ORDER.filter((continent) => counts.has(continent)).map((continent) => ({
    continent,
    artistCount: counts.get(continent)!,
  }))
}

export type CountryCount = { countryCode: string; artistCount: number }

export function groupArtistsByCountry(
  artists: { countryCode: string | null }[],
  continent: string,
  countryToContinent: Map<string, string>
): CountryCount[] {
  const counts = new Map<string, number>()
  for (const artist of artists) {
    if (!artist.countryCode) continue
    const code = artist.countryCode.toLowerCase()
    const artistContinent = countryToContinent.get(code) ?? 'その他'
    if (artistContinent !== continent) continue
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([countryCode, artistCount]) => ({ countryCode, artistCount }))
    .sort((a, b) => b.artistCount - a.artistCount)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- --test-name-pattern "buildCountryToContinentMap|groupArtistsByContinent|groupArtistsByCountry"`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add public/geo/world-countries.json utils/artistOriginMap.ts __tests__/artist-origin-map.unit.test.ts
git commit -m "feat: add world country boundaries asset and continent/country aggregation"
```

---

### Task 2: Boundary-availability and per-artist target resolution (`utils/artistOriginBoundary.ts`)

**Files:**
- Create: `utils/artistOriginBoundary.ts`
- Test: `__tests__/artist-origin-boundary.unit.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (for Task 5 to consume):
  - `type BoundaryCodeSet = { municipalityCodes: Set<string>; regionCodes: Set<string> }`
  - `hasBoundaryDataForCountry(artistsInCountry: { regionCode: string | null; muniCode: string | null }[], cached: BoundaryCodeSet): boolean`
  - `type ArtistOriginTarget = { level: 'municipality'; code: string } | { level: 'region'; code: string } | { level: 'country'; code: string } | { level: 'point' }`
  - `resolveArtistTarget(artist: { countryCode: string | null; regionCode: string | null; muniCode: string | null }, cached: BoundaryCodeSet): ArtistOriginTarget`

- [ ] **Step 1: Write the failing unit test**

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern "hasBoundaryDataForCountry|resolveArtistTarget"`
Expected: FAIL — `../utils/artistOriginBoundary.ts` does not exist yet.

- [ ] **Step 3: Implement `utils/artistOriginBoundary.ts`**

```typescript
// utils/artistOriginBoundary.ts
//
// origin_region_code/origin_muni_codeが設定されていても、対応するgeo_boundary
// 行が無い場合がある(実データで確認済み: Nominatim/Natural Earthの粒度差により
// 英国・フランスの一部地域は永続的にポリゴンが存在しない)。このモジュールは
// 「実際に塗りつぶし可能な最も細かいレベルはどこか」を、コード自体の有無ではなく
// geo_boundaryに実在するコードの集合と突き合わせて決める。

export type BoundaryCodeSet = {
  municipalityCodes: Set<string>
  regionCodes: Set<string>
}

export function hasBoundaryDataForCountry(
  artistsInCountry: { regionCode: string | null; muniCode: string | null }[],
  cached: BoundaryCodeSet
): boolean {
  return artistsInCountry.some(
    (artist) =>
      (artist.muniCode !== null && cached.municipalityCodes.has(artist.muniCode)) ||
      (artist.regionCode !== null && cached.regionCodes.has(artist.regionCode))
  )
}

export type ArtistOriginTarget =
  | { level: 'municipality'; code: string }
  | { level: 'region'; code: string }
  | { level: 'country'; code: string }
  | { level: 'point' }

export function resolveArtistTarget(
  artist: { countryCode: string | null; regionCode: string | null; muniCode: string | null },
  cached: BoundaryCodeSet
): ArtistOriginTarget {
  if (artist.muniCode !== null && cached.municipalityCodes.has(artist.muniCode)) {
    return { level: 'municipality', code: artist.muniCode }
  }
  if (artist.regionCode !== null && cached.regionCodes.has(artist.regionCode)) {
    return { level: 'region', code: artist.regionCode }
  }
  if (artist.countryCode !== null) {
    return { level: 'country', code: artist.countryCode }
  }
  return { level: 'point' }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --test-name-pattern "hasBoundaryDataForCountry|resolveArtistTarget"`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add utils/artistOriginBoundary.ts __tests__/artist-origin-boundary.unit.test.ts
git commit -m "feat: add boundary-availability and artist target-level resolution"
```

---

### Task 3: On-demand geo_boundary API route

**Files:**
- Create: `app/api/map/geo-boundary/route.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (independent of Tasks 1-2).
- Produces (for Task 5 to consume): `GET /api/map/geo-boundary?level=municipality|region&codes=code1,code2` → `{ code: string; name: string | null; geometry: Record<string, unknown> }[]` JSON response.

- [ ] **Step 1: Implement the route**

```typescript
// app/api/map/geo-boundary/route.ts
//
// マップのアーティスト出身地ドリルダウン表示専用。geo_boundaryは行によっては
// 数百KBあるため、選択中の国のアーティストが実際に使っているコードだけを
// クエリパラメータで指定して取得する(テーブル全件のselectは絶対に行わない)。
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/Supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const level = searchParams.get('level')
  const codesParam = searchParams.get('codes')

  if (level !== 'municipality' && level !== 'region') {
    return NextResponse.json({ error: 'level must be "municipality" or "region"' }, { status: 400 })
  }
  if (!codesParam) {
    return NextResponse.json({ error: 'codes is required' }, { status: 400 })
  }

  const codes = codesParam.split(',').filter(Boolean)
  if (codes.length === 0) {
    return NextResponse.json([])
  }

  const supabase = await createClient()
  const { data, error } = await supabase.from('geo_boundary').select('code, name, geometry').eq('level', level).in('code', codes)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Verify against real data**

Start the dev server and query with real cached codes (Chiyoda ward `13104` and California `US-CA` are both confirmed present in production `geo_boundary`):

```bash
npm run dev &
sleep 3
curl -s -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASSWORD" "http://localhost:3000/api/map/geo-boundary?level=municipality&codes=13104" | head -c 300
echo
curl -s -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASSWORD" "http://localhost:3000/api/map/geo-boundary?level=region&codes=US-CA" | head -c 300
echo
curl -s -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASSWORD" "http://localhost:3000/api/map/geo-boundary?level=municipality&codes=99999" 
```

(Read `BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD` from `.env.local` — do not print their values in any report or commit message, per this project's standing credential-handling rule.)

Expected: the first two return a JSON array with one object each (`code`, `name`, a `geometry` object); the third (a nonexistent code) returns `[]`.

- [ ] **Step 4: Commit**

```bash
git add app/api/map/geo-boundary/route.ts
git commit -m "feat: add on-demand geo_boundary polygon API route"
```

---

### Task 4: `LeafletMap.tsx` polygon rendering support

**Files:**
- Modify: `app/map/LeafletMap.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (independent; only touches the existing `LeafletMap` component).
- Produces (for Task 5 to consume): new exported type `MapPolygon = { id: string; geometry: Record<string, unknown>; color: string; popupHtml: string }`; `LeafletMap` accepts new optional props `polygons?: MapPolygon[]` and `onPolygonClick?: (id: string) => void`; the existing `focusId` prop now also matches polygon ids (flies to and fits the polygon's bounds), not just marker ids.

This task has no automated test — `LeafletMap` is a Leaflet-imperative client component with no existing test coverage in this codebase (matching the established pattern: Leaflet/DOM-heavy components are verified via the dev server, not `node --test`). Verification is manual, via Task 5's component once it exists — but since Task 4 must ship independently and reviewably, verify this task via a typecheck and a quick manual smoke check described in Step 3 below.

- [ ] **Step 1: Read the current file**

Read `app/map/LeafletMap.tsx` in full before editing — you need the exact current content to edit against (this plan was written from that file; a subsequent unrelated change could have shifted line numbers).

- [ ] **Step 2: Add the `MapPolygon` type and extend the component**

Add this type near the existing `MapMarker` type (after it):

```typescript
export type MapPolygon = {
  id: string
  /** GeoJSON Geometry(Polygon/MultiPolygon)。geo_boundaryやworld-countries.jsonの
   * featureからそのまま渡す想定 */
  geometry: Record<string, unknown>
  color: string
  /** 空文字列ならポップアップを出さない(親コンポーネント側で「ここは即座に
   * さらにドリルダウンするのでポップアップ不要」と判断した場合に使う) */
  popupHtml: string
}
```

Update the component's props destructuring and signature:

```typescript
export default function LeafletMap({
  markers,
  polygons = [],
  heightClassName = 'h-[600px]',
  focusId,
  onMarkerHover,
  onMarkerClick,
  onPolygonClick,
}: {
  markers: MapMarker[]
  polygons?: MapPolygon[]
  heightClassName?: string
  focusId?: string | null
  onMarkerHover?: (id: string | null) => void
  onMarkerClick?: (id: string) => void
  /** ポリゴンをクリックした時に呼ばれる(ドリルダウンの状態遷移などに利用) */
  onPolygonClick?: (id: string) => void
}) {
```

Add a ref for the new callback, alongside the existing `onMarkerHoverRef`/`onMarkerClickRef`:

```typescript
const onPolygonClickRef = useRef(onPolygonClick)
useEffect(() => {
  onMarkerHoverRef.current = onMarkerHover
  onMarkerClickRef.current = onMarkerClick
  onPolygonClickRef.current = onPolygonClick
}, [onMarkerHover, onMarkerClick, onPolygonClick])
```

(This replaces the existing 3-line `useEffect` that only synced the first two refs — extend it, don't duplicate it.)

In the marker-rendering `useEffect` (the one that creates `layerGroup`, currently keyed on `[markers]`), change its dependency array to `[markers, polygons]` and add polygon rendering after the existing marker loop, before the `if (markers.length > 0)` bounds-fitting block:

```typescript
for (const polygon of polygons) {
  const geoJsonLayer = L.geoJSON(polygon.geometry as GeoJSON.GeoJsonObject, {
    style: {
      color: polygon.color,
      weight: 1,
      fillColor: polygon.color,
      fillOpacity: 0.35,
    },
  }).addTo(layerGroup)
  if (polygon.popupHtml) {
    geoJsonLayer.bindPopup(polygon.popupHtml)
  }
  geoJsonLayer.on('click', () => onPolygonClickRef.current?.(polygon.id))
}
```

Update the bounds-fitting condition right after (currently `if (markers.length > 0) { map.fitBounds(...) }`) to also account for polygons:

```typescript
if (markers.length > 0 || polygons.length > 0) {
  map.fitBounds(layerGroup.getBounds(), { padding: [40, 40], maxZoom: 12 })
}
```

Track the created polygon layers the same way markers are tracked, so `focusId` can target a polygon too. Add a new ref alongside the existing `leafletMarkersRef`:

```typescript
const leafletPolygonsRef = useRef<Map<string, L.GeoJSON>>(new Map())
```

Inside the polygon-rendering loop you just added, record each layer into a local map first, then assign it to the ref after the loop (mirroring exactly how `leafletMarkers`/`leafletMarkersRef` are built for markers earlier in the same effect):

```typescript
const leafletPolygons = new Map<string, L.GeoJSON>()
for (const polygon of polygons) {
  const geoJsonLayer = L.geoJSON(polygon.geometry as GeoJSON.GeoJsonObject, {
    style: {
      color: polygon.color,
      weight: 1,
      fillColor: polygon.color,
      fillOpacity: 0.35,
    },
  }).addTo(layerGroup)
  if (polygon.popupHtml) {
    geoJsonLayer.bindPopup(polygon.popupHtml)
  }
  geoJsonLayer.on('click', () => onPolygonClickRef.current?.(polygon.id))
  leafletPolygons.set(polygon.id, geoJsonLayer)
}
leafletPolygonsRef.current = leafletPolygons
```

Finally, extend the existing `focusId` effect (currently only looks up `leafletMarkersRef.current.get(focusId)` and calls `map.flyTo(marker.getLatLng(), ...)`) to also check the polygons ref and fly to bounds instead of a point when the id matches a polygon:

```typescript
useEffect(() => {
  const map = mapRef.current
  if (!map || !focusId) return

  const marker = leafletMarkersRef.current.get(focusId)
  if (marker) {
    const targetZoom = Math.max(map.getZoom(), FOCUS_ZOOM)
    map.flyTo(marker.getLatLng(), targetZoom, { duration: 0.8 })
    marker.openPopup()
    return
  }

  const polygon = leafletPolygonsRef.current.get(focusId)
  if (polygon) {
    map.flyToBounds(polygon.getBounds(), { padding: [60, 60], duration: 0.8 })
    polygon.openPopup()
  }
}, [focusId])
```

This replaces the existing `focusId` `useEffect` entirely (same dependency array `[focusId]`, just the body grows to check both refs instead of only markers).

- [ ] **Step 3: Typecheck and smoke-verify**

Run: `npx tsc --noEmit -p .`
Expected: no errors. If `GeoJSON.GeoJsonObject` is not recognized, `leaflet`'s own type declarations (`@types/leaflet`, already a dependency) pull in `@types/geojson` transitively — check `node_modules/@types/geojson` exists; if TypeScript still complains, use `polygon.geometry as unknown as GeoJSON.GeoJsonObject` instead of the direct cast, or fall back to `L.geoJSON(polygon.geometry as any, ...)` with a one-line comment explaining why — either is acceptable, this is normal type-friction resolution, not a design change.

Existing behavior must not regress: `app/map/TabbedMapView.tsx` and `app/map/MapClientWrapper.tsx` both call `<LeafletMap markers={...} .../>` without a `polygons` prop — confirm (by reading those two files) that omitting `polygons` still compiles cleanly (it will, since the prop is optional with a default), so venue/shop tabs and the event-schedule map usage are unaffected by this change.

- [ ] **Step 4: Commit**

```bash
git add app/map/LeafletMap.tsx
git commit -m "feat: add optional polygon (choropleth) rendering to LeafletMap"
```

---

### Task 5: Drill-down state machine component (`app/map/ArtistOriginMap.tsx`)

**Files:**
- Create: `app/map/ArtistOriginMap.tsx`
- Modify: `utils/format.ts` (add a shared `escapeHtml` export)

**Interfaces:**
- Consumes: `buildCountryToContinentMap`, `groupArtistsByContinent`, `groupArtistsByCountry`, `CONTINENT_ORDER`, `CONTINENT_CENTER`, `NaturalEarthCountryFeature` from `utils/artistOriginMap.ts` (Task 1); `hasBoundaryDataForCountry`, `resolveArtistTarget`, `BoundaryCodeSet` from `utils/artistOriginBoundary.ts` (Task 2); `GET /api/map/geo-boundary` from Task 3; `MapMarker`, `MapPolygon` and the extended `LeafletMap` props from Task 4.
- Produces (for Task 6 to consume): `export type ArtistOriginRow = { id: string; name: string; imageUrl: string | null; latitude: number; longitude: number; countryCode: string | null; regionCode: string | null; muniCode: string | null; popupHtml: string }`; default-exported component `ArtistOriginMap({ artists, countryFeatures, boundaryCodeSet, selectedArtistId, onSelectArtist }: { artists: ArtistOriginRow[]; countryFeatures: NaturalEarthCountryFeature[]; boundaryCodeSet: BoundaryCodeSet; selectedArtistId: string | null; onSelectArtist: (id: string | null) => void })`.

This task, like Task 4, has no automated test (client component with browser-only DOM/fetch behavior) — verify via the dev server in Step 4 below. It depends on Tasks 1-4 all being complete.

- [ ] **Step 1: Add a shared `escapeHtml` helper**

`app/map/page.tsx` currently defines its own local (non-exported) `escapeHtml` function. This task's component also needs to safely embed artist names into popup HTML strings, so add a shared version other files can import instead of each defining their own.

Add to `utils/format.ts` (anywhere among the other exports):

```typescript
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
```

Do not modify `app/map/page.tsx` in this task — Task 6 will switch it to import this shared version instead of its local copy, since Task 6 is the task that actually edits that file's data-fetching logic. Leave `page.tsx`'s existing local `escapeHtml` untouched for now (there will briefly be two copies until Task 6 lands; that's expected and fine).

- [ ] **Step 2: Implement `app/map/ArtistOriginMap.tsx`**

```tsx
// app/map/ArtistOriginMap.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { escapeHtml } from '@/utils/format'
import type { MapMarker, MapPolygon } from './LeafletMap'
import {
  buildCountryToContinentMap,
  groupArtistsByContinent,
  groupArtistsByCountry,
  CONTINENT_CENTER,
  type NaturalEarthCountryFeature,
} from '@/utils/artistOriginMap'
import { hasBoundaryDataForCountry, resolveArtistTarget, type BoundaryCodeSet } from '@/utils/artistOriginBoundary'

const LeafletMap = dynamic(() => import('./LeafletMap'), { ssr: false })

export type ArtistOriginRow = {
  id: string
  name: string
  imageUrl: string | null
  latitude: number
  longitude: number
  countryCode: string | null
  regionCode: string | null
  muniCode: string | null
  /** アーティスト単体の点マーカー用ポップアップ(既存page.tsxの書式を流用) */
  popupHtml: string
}

type DrillState =
  | { level: 'world' }
  | { level: 'continent'; continent: string }
  | { level: 'country'; continent: string; countryCode: string }

type BoundaryFeature = { code: string; name: string | null; geometry: Record<string, unknown> }

export default function ArtistOriginMap({
  artists,
  countryFeatures,
  boundaryCodeSet,
  selectedArtistId,
  onSelectArtist,
}: {
  artists: ArtistOriginRow[]
  countryFeatures: NaturalEarthCountryFeature[]
  boundaryCodeSet: BoundaryCodeSet
  /** 一覧パネルでアーティストが選ばれたら、そのアーティストの粒度まで直接ドリルダウンする */
  selectedArtistId: string | null
  onSelectArtist: (id: string | null) => void
}) {
  const [drill, setDrill] = useState<DrillState>({ level: 'world' })
  const [regionFeatures, setRegionFeatures] = useState<BoundaryFeature[]>([])
  const [loadingRegions, setLoadingRegions] = useState(false)

  const countryToContinent = useMemo(() => buildCountryToContinentMap(countryFeatures), [countryFeatures])
  const countryFeatureByCode = useMemo(() => {
    const map = new Map<string, NaturalEarthCountryFeature>()
    for (const feature of countryFeatures) {
      const iso = feature.properties.ISO_A2?.toLowerCase()
      if (iso) map.set(iso, feature)
    }
    return map
  }, [countryFeatures])

  // アーティスト一覧から選択されたら、そのアーティストの国の階層まで直接ドリルダウンする
  // (市区町村/州地域そのものへのズームはCountry状態のLeafletMapのfocusIdで行う)
  useEffect(() => {
    if (!selectedArtistId) return
    const artist = artists.find((a) => a.id === selectedArtistId)
    if (!artist?.countryCode) return
    const continent = countryToContinent.get(artist.countryCode.toLowerCase()) ?? 'その他'
    setDrill({ level: 'country', continent, countryCode: artist.countryCode.toLowerCase() })
  }, [selectedArtistId, artists, countryToContinent])

  // Country状態に入ったら、その国のアーティスト達が使っているregion/muniコードに
  // 対応するポリゴンだけをオンデマンドで取得する(geo_boundary全件は絶対に取らない)
  useEffect(() => {
    if (drill.level !== 'country') {
      setRegionFeatures([])
      return
    }
    const artistsInCountry = artists.filter((a) => a.countryCode?.toLowerCase() === drill.countryCode)
    const muniCodes = [...new Set(artistsInCountry.map((a) => a.muniCode).filter((c): c is string => Boolean(c)))]
    const regionCodes = [...new Set(artistsInCountry.map((a) => a.regionCode).filter((c): c is string => Boolean(c)))]

    let cancelled = false
    async function load() {
      setLoadingRegions(true)
      const results: BoundaryFeature[] = []
      if (muniCodes.length > 0) {
        const res = await fetch(`/api/map/geo-boundary?level=municipality&codes=${muniCodes.join(',')}`)
        if (res.ok) results.push(...((await res.json()) as BoundaryFeature[]))
      }
      if (regionCodes.length > 0) {
        const res = await fetch(`/api/map/geo-boundary?level=region&codes=${regionCodes.join(',')}`)
        if (res.ok) results.push(...((await res.json()) as BoundaryFeature[]))
      }
      if (!cancelled) {
        setRegionFeatures(results)
        setLoadingRegions(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [drill, artists])

  if (drill.level === 'world') {
    const continents = groupArtistsByContinent(artists, countryToContinent)
    const markers: MapMarker[] = continents
      .filter((c) => CONTINENT_CENTER[c.continent])
      .map((c) => ({
        id: `continent-${c.continent}`,
        latitude: CONTINENT_CENTER[c.continent][0],
        longitude: CONTINENT_CENTER[c.continent][1],
        color: '#e8a63c',
        category: 'artist' as const,
        label: `${c.continent}(${c.artistCount})`,
        popupHtml: `<div style="font-weight:bold;">${escapeHtml(c.continent)}: ${c.artistCount}組</div>`,
      }))

    return (
      <LeafletMap
        markers={markers}
        onMarkerClick={(id) => setDrill({ level: 'continent', continent: id.replace('continent-', '') })}
      />
    )
  }

  if (drill.level === 'continent') {
    const countries = groupArtistsByCountry(artists, drill.continent, countryToContinent)
    const polygons: MapPolygon[] = countries
      .map((c) => {
        const feature = countryFeatureByCode.get(c.countryCode)
        if (!feature) return null
        const artistsInCountry = artists.filter((a) => a.countryCode?.toLowerCase() === c.countryCode)
        const willDrillDown = hasBoundaryDataForCountry(
          artistsInCountry.map((a) => ({ regionCode: a.regionCode, muniCode: a.muniCode })),
          boundaryCodeSet
        )
        return {
          id: `country-${c.countryCode}`,
          geometry: feature.geometry,
          color: '#5aa9e6',
          popupHtml: willDrillDown
            ? ''
            : `<div style="font-weight:bold;">${escapeHtml(feature.properties.ADMIN ?? c.countryCode.toUpperCase())}: ${c.artistCount}組</div>`,
        }
      })
      .filter((p): p is MapPolygon => p !== null)

    return (
      <div>
        <button
          type="button"
          onClick={() => setDrill({ level: 'world' })}
          className="mb-2 text-xs text-white/40 hover:text-white/70"
        >
          ← 大陸一覧に戻る
        </button>
        <LeafletMap
          markers={[]}
          polygons={polygons}
          onPolygonClick={(id) => {
            const countryCode = id.replace('country-', '')
            const artistsInCountry = artists.filter((a) => a.countryCode?.toLowerCase() === countryCode)
            const willDrillDown = hasBoundaryDataForCountry(
              artistsInCountry.map((a) => ({ regionCode: a.regionCode, muniCode: a.muniCode })),
              boundaryCodeSet
            )
            if (willDrillDown) {
              setDrill({ level: 'country', continent: drill.continent, countryCode })
            }
          }}
        />
      </div>
    )
  }

  // drill.level === 'country'
  const artistsInCountry = artists.filter((a) => a.countryCode?.toLowerCase() === drill.countryCode)
  const fallbackMarkers: MapMarker[] = artistsInCountry
    .filter((a) => resolveArtistTarget(a, boundaryCodeSet).level === 'point')
    .map((a) => ({
      id: `artist-${a.id}`,
      latitude: a.latitude,
      longitude: a.longitude,
      color: '#e85d5d',
      category: 'artist' as const,
      label: a.name,
      imageUrl: a.imageUrl,
      popupHtml: a.popupHtml,
    }))
  const polygons: MapPolygon[] = regionFeatures.map((feature) => {
    const matchingArtists = artistsInCountry.filter((a) => a.muniCode === feature.code || a.regionCode === feature.code)
    const artistListHtml = matchingArtists
      .map(
        (a) =>
          `<div style="margin-top:4px;"><a href="/artists/${escapeHtml(a.id)}" style="color:inherit;">${escapeHtml(a.name)}</a></div>`
      )
      .join('')
    return {
      id: `boundary-${feature.code}`,
      geometry: feature.geometry,
      color: '#e85d5d',
      popupHtml: `<div style="font-weight:bold;">${escapeHtml(feature.name ?? feature.code)}</div>${artistListHtml}`,
    }
  })

  // 選択中のアーティストがこの国に属するなら、そのアーティストの解決済み最深レベル
  // (市区町村/州地域のポリゴン、または解決できなければ点マーカー)までズームする
  const selectedArtist = artistsInCountry.find((a) => a.id === selectedArtistId)
  const focusId = selectedArtist
    ? (() => {
        const target = resolveArtistTarget(selectedArtist, boundaryCodeSet)
        if (target.level === 'municipality' || target.level === 'region') return `boundary-${target.code}`
        if (target.level === 'point') return `artist-${selectedArtist.id}`
        return null
      })()
    : null

  return (
    <div>
      <button
        type="button"
        onClick={() => setDrill({ level: 'continent', continent: drill.continent })}
        className="mb-2 text-xs text-white/40 hover:text-white/70"
      >
        ← {drill.continent}の国一覧に戻る
      </button>
      {loadingRegions && <p className="mb-2 text-xs text-white/40">読み込み中...</p>}
      <LeafletMap markers={fallbackMarkers} polygons={polygons} focusId={focusId} />
    </div>
  )
}
```

Note on `target.level === 'country'` (the GB/FR case — a specific artist resolves no finer than the country itself): there is no polygon or marker for a bare country-level target inside the Country state's own map (the country polygon itself is only rendered one level up, in the Continent state), so `focusId` stays `null` for that artist and the view simply shows the country's other fallback markers/polygons without an extra fly-to. This is an acceptable, minor UX gap (the user still lands in the right country's view, just not zoomed to any specific highlight) — do not attempt to also render the enclosing country polygon inside Country state to fix this; that would require duplicating Continent-state polygon data here and is out of scope for this task.

Note: `Link` and `onSelectArtist` are declared/imported but this component itself does not render an artist list (Task 6's `TabbedMapView` keeps owning the side list panel, same as today) — `onSelectArtist` is accepted for interface completeness/future use but not called from inside this component in this task; remove the unused `Link` import if your editor/linter flags it, since nothing in this file's current JSX uses it.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors (remove the unused `Link` import mentioned above if TypeScript's `noUnusedLocals` or ESLint flags it).

- [ ] **Step 4: Manual smoke verification**

This component isn't wired into any page yet (Task 6 does that), so verify it in isolation isn't practical via the browser yet. Instead, confirm structurally:
- Re-read the finished file and check every branch (`world`/`continent`/`country`) returns valid JSX and that `LeafletMap` is always called with a `markers` array (never `undefined`).
- Confirm the `useEffect` for fetching region/municipality boundaries has a cleanup function that sets `cancelled = true` (prevents a state update after unmount/re-drill, avoiding a React warning).

Full end-to-end browser verification happens in Task 6, once this component is actually rendered on `/map`.

- [ ] **Step 5: Commit**

```bash
git add app/map/ArtistOriginMap.tsx utils/format.ts
git commit -m "feat: add continent/country/region drill-down map component"
```

---

### Task 6: Wire the drill-down into `/map`

**Files:**
- Modify: `app/map/page.tsx`
- Modify: `app/map/TabbedMapView.tsx`

**Interfaces:**
- Consumes: `ArtistOriginMap`, `ArtistOriginRow` from `app/map/ArtistOriginMap.tsx` (Task 5); `NaturalEarthCountryFeature` from `utils/artistOriginMap.ts` (Task 1); `BoundaryCodeSet` from `utils/artistOriginBoundary.ts` (Task 2); `escapeHtml` from `utils/format.ts` (Task 5's addition).
- Produces: nothing further — this is the plan's final integration task.

- [ ] **Step 1: Read both files fresh**

Read the current `app/map/page.tsx` and `app/map/TabbedMapView.tsx` in full before editing.

- [ ] **Step 2: Extend `app/map/page.tsx`'s artist query and add server-side data prep**

In the artist query (currently `supabase.from('artist').select('id, name, image_url, origin_latitude, origin_longitude, origin_prefecture, hometown_city, hometown_country')`), add the 3 new columns:

```typescript
const { data: artists } = await supabase
  .from('artist')
  .select(
    'id, name, image_url, origin_latitude, origin_longitude, origin_prefecture, hometown_city, hometown_country, origin_country_code, origin_region_code, origin_muni_code'
  )
  .not('origin_latitude', 'is', null)
  .not('origin_longitude', 'is', null)
```

Remove the file's local `escapeHtml` function definition and import the shared one instead:

```typescript
import { escapeHtml } from '@/utils/format'
```

(Delete the existing local `function escapeHtml(value: string): string { ... }` block entirely — it's now redundant with Task 5's addition to `utils/format.ts`.)

After the existing `artistMarkers` construction (leave that array as-is — it's still used for the fallback/point-marker case data shape, and other tabs' logic is unaffected), add:

```typescript
import { readFileSync } from 'fs'
import path from 'path'
import type { NaturalEarthCountryFeature } from '@/utils/artistOriginMap'
import type { BoundaryCodeSet } from '@/utils/artistOriginBoundary'
import ArtistOriginMap, { type ArtistOriginRow } from './ArtistOriginMap'
```

(add these imports near the top of the file, alongside the existing imports)

```typescript
const worldCountriesRaw = readFileSync(path.join(process.cwd(), 'public/geo/world-countries.json'), 'utf-8')
const worldCountries: { features: NaturalEarthCountryFeature[] } = JSON.parse(worldCountriesRaw)

const { data: cachedBoundaries } = await supabase.from('geo_boundary').select('level, code')
const boundaryCodeSet: BoundaryCodeSet = {
  municipalityCodes: new Set((cachedBoundaries ?? []).filter((b) => b.level === 'municipality').map((b) => b.code)),
  regionCodes: new Set((cachedBoundaries ?? []).filter((b) => b.level === 'region').map((b) => b.code)),
}

const artistOriginRows: ArtistOriginRow[] = (artists ?? [])
  .filter((a) => a.origin_latitude != null && a.origin_longitude != null)
  .map((a) => {
    const marker = artistMarkers.find((m) => m.id === `artist-${a.id}`)
    return {
      id: a.id,
      name: a.name,
      imageUrl: a.image_url,
      latitude: Number(a.origin_latitude),
      longitude: Number(a.origin_longitude),
      countryCode: a.origin_country_code,
      regionCode: a.origin_region_code,
      muniCode: a.origin_muni_code,
      popupHtml: marker?.popupHtml ?? '',
    }
  })
```

This reads the static world-countries file directly from disk (server-side, no HTTP round-trip — this file is only ~725KB and only needs parsing once per request, matching the existing `readFileSync`-at-request-time pattern being introduced here; there's no prior precedent for reading `public/` files server-side in this repo, so this is new but standard Next.js practice) and reuses the already-built `artistMarkers` array's `popupHtml` (built earlier in this same file) rather than reconstructing the same HTML twice.

Finally, pass the new data down to `TabbedMapView` alongside the existing `markers` prop:

```tsx
<TabbedMapView
  markers={markers}
  artistOriginRows={artistOriginRows}
  countryFeatures={worldCountries.features}
  boundaryCodeSet={boundaryCodeSet}
/>
```

- [ ] **Step 3: Update `app/map/TabbedMapView.tsx` to render the drill-down for the artist tab**

Add the new props to the component signature and imports:

```typescript
import ArtistOriginMap, { type ArtistOriginRow } from './ArtistOriginMap'
import type { NaturalEarthCountryFeature } from '@/utils/artistOriginMap'
import type { BoundaryCodeSet } from '@/utils/artistOriginBoundary'
```

```typescript
export default function TabbedMapView({
  markers,
  artistOriginRows,
  countryFeatures,
  boundaryCodeSet,
}: {
  markers: MapMarker[]
  artistOriginRows: ArtistOriginRow[]
  countryFeatures: NaturalEarthCountryFeature[]
  boundaryCodeSet: BoundaryCodeSet
}) {
```

The component keeps its existing `activeTab`/`focusId` state and side-list panel exactly as-is for the `venue`/`shop` tabs (no changes to that rendering path). For the `artist` tab specifically, replace the `<LeafletMap ... />` call with a conditional: when `activeTab === 'artist'`, render `<ArtistOriginMap>` instead of `<LeafletMap>`. Change the map-rendering block from:

```tsx
<div className="lg:flex-1">
  <LeafletMap
    markers={filteredMarkers}
    focusId={focusId}
    onMarkerHover={(id) => setFocusId(id ?? null)}
    onMarkerClick={setFocusId}
  />
</div>
```

to:

```tsx
<div className="lg:flex-1">
  {activeTab === 'artist' ? (
    <ArtistOriginMap
      artists={artistOriginRows}
      countryFeatures={countryFeatures}
      boundaryCodeSet={boundaryCodeSet}
      selectedArtistId={focusId}
      onSelectArtist={setFocusId}
    />
  ) : (
    <LeafletMap
      markers={filteredMarkers}
      focusId={focusId}
      onMarkerHover={(id) => setFocusId(id ?? null)}
      onMarkerClick={setFocusId}
    />
  )}
</div>
```

The side-list panel below (the `<ul>` of `filteredMarkers`) stays completely unchanged — it still lists individual artists by name/image for the `artist` tab (from the existing `markers` prop, filtered by category, exactly as today), and clicking a list item still calls `setFocusId(marker.id)`, which now additionally drives `ArtistOriginMap`'s drill-down via its `selectedArtistId` prop (Task 5's `useEffect` on `selectedArtistId`) whenever the artist tab is active.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass (including the new ones from Tasks 1-2; nothing in this task changes test files).

- [ ] **Step 6: Verify locally against real data**

```bash
npm run dev &
sleep 3
curl -s -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASSWORD" -o /tmp/map.html -w "%{http_code}\n" "http://localhost:3000/map"
grep -o 'アジア\|北米\|ヨーロッパ' /tmp/map.html | sort -u
```

(Again, read the Basic Auth credentials from `.env.local` and never print their values.)

Expected: HTTP 200, and at least `アジア`/`北米`/`ヨーロッパ` appear (matching the real production continent distribution verified earlier: jp/th/ph → アジア, us/ca/br/jm → 北米, gb/ie/fr/be → ヨーロッパ, nz → オセアニア).

Then, using a browser (or by inspecting the rendered page manually since this is an interactive Leaflet feature that can't be fully verified via curl alone), open `http://localhost:3000/map` with Basic Auth, select the "アーティスト" tab, and confirm:
- The world view shows continent markers with counts.
- Clicking a continent (e.g. アジア) zooms in and shows country-level fills (e.g. Japan, Thailand, Philippines all lightly shaded).
- Clicking Japan's fill (which has real `geo_boundary` municipality data) auto-advances to municipality-level shading.
- Clicking a UK-continent country from ヨーロッパ (which per the known GB/FR gap has `origin_region_code` set but no cached polygon) does NOT auto-advance — it shows a country-level popup instead, confirming the fallback works as designed.
- Selecting an artist from the side list jumps the map to their country/drill level.

If real-browser interaction isn't available in your environment, describe in your report exactly which of these you were able to confirm via code inspection versus actual interaction, and flag anything you could not verify.

- [ ] **Step 7: Commit**

```bash
git add app/map/page.tsx app/map/TabbedMapView.tsx
git commit -m "feat: wire continent/country/region drill-down into the artist map tab"
```

---

## After this plan lands

- Deploy to production (`env -u VERCEL_OIDC_TOKEN npx vercel --prod --yes`, matching this project's established deploy flow) and re-verify the same checks from Task 6 Step 6 against the live site.
- Consider whether `public/geo/world-countries.json` needs periodic refreshing — Natural Earth data changes rarely (administrative boundaries are stable), so this is very low priority, but note it exists as a point-in-time snapshot, not a live-fetched resource.
- The `geo_boundary` repair pass (`scripts/backfill-artist-origin-geo-codes.ts`, from the data-layer plan) should be re-run periodically as new artists get geocoded, so newly-added artists' municipality/region polygons are ready before this UI needs them — otherwise a brand-new artist will render as a fallback point until the next backfill run.
