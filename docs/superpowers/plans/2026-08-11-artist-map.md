# アーティスト・会場マップ(地図UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アーティストの出生地/結成地と会場の実座標データを、Leaflet + OpenStreetMapによる実地図上にピン表示し、クリックでアーティスト情報/会場の開催イベント情報をポップアップ表示する`/map`ページを新設する。

**Architecture:** ドメイン非依存の汎用地図コンポーネント(`LeafletMap`)を作り、`/map`ページ(Server Component)がアーティスト・会場・イベントのデータを取得してマーカー配列に変換し渡す。Leafletはブラウザの`window`に依存するため、`next/dynamic({ ssr: false })`を使うクライアント専用の薄いラッパーを介して読み込む。

**Tech Stack:** Next.js App Router (Server Components)、Supabase(`@supabase/ssr`で読み取り)、Leaflet(新規依存、地図描画本体、Reactラッパーは使わず直接扱う)、OpenStreetMapタイル(認証不要・無料)。

## Global Constraints

- 新規テーブル・カラムは無い。既存の`artist.origin_latitude`/`origin_longitude`(numeric、null許容)、`venue_location`(`id`, `venue_name`, `latitude`, `longitude`, `source`)、`music_event`/`event_edition`/`event_appearance`の`venue`列(自由入力text)をそのまま読む。
- 会場名の突き合わせは、`venue_location.venue_name`と`music_event`/`event_edition`/`event_appearance`の`venue`列の両方を`normalizeVenueName()`(`trim()` + `normalize('NFKC')`)で正規化してから文字列比較する。既存データへの書き込み側の変更(マイグレーション)は行わない。
- Leafletは`window`/`document`に依存するため、Server Componentから直接importできない。`next/dynamic(() => import('./LeafletMap'), { ssr: false })`を使うが、このNext.jsバージョンでは`ssr: false`はClient Component内でのみ有効(`node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`で確認済み)。そのため`app/map/page.tsx`(Server Component)から直接`dynamic()`を呼ばず、`'use client'`の薄いラッパーコンポーネントを経由すること。
- マーカーのアイコンはLeafletのデフォルトマーカー画像(バンドラーでパスが壊れる既知の問題がある)を使わず、`L.divIcon`でCSSの円形アイコンを自前描画する。アーティストは赤系(`#e85d5d`)、会場は青系(`#5aa9e6`)で色分けする。
- ポップアップの中身はLeafletの`bindPopup()`にHTML文字列を渡す方式(Reactコンポーネントではない)。DBから読んだ値(アーティスト名・アルバム名・会場名・イベント名)はすべてHTMLエスケープしてから埋め込むこと(XSS対策)。
- `/events/[id]`のURLパスパラメータは`event`テーブルの`id`(`event_edition.event_id`)であり、`event_edition.id`ではない。特定の開催年を指定するには`?year=`クエリパラメータを使う(例: `/events/${event_id}?year=${year}`)。この既存の`app/events/[id]/page.tsx`のURL規約を踏襲すること。
- `music_event`には専用の公開詳細ページが無い(`app/artists/[id]/page.tsx`のLive Infoセクションに埋め込み表示されるのみ)。会場ポップアップから`music_event`由来のイベントへリンクする場合は、そのイベントのアーティストページ(`/artists/${artist_id}`)へリンクする。
- 自動テストは追加しない。検証は`npx tsc --noEmit`と実機確認(ブラウザで`/map`を開き、パン・ズーム・ポップアップ・リンク遷移を確認)で行う。

---

### Task 1: 汎用Leaflet地図コンポーネント

**Files:**
- Modify: `package.json`(`leaflet`・`@types/leaflet`を依存に追加)
- Create: `utils/textNormalize.ts`
- Create: `app/map/LeafletMap.tsx`
- Create: `app/map/MapClientWrapper.tsx`

**Interfaces:**
- Produces:
  - `utils/textNormalize.ts`: `export function normalizeVenueName(value: string): string`
  - `app/map/LeafletMap.tsx`: `export type MapMarker = { id: string; latitude: number; longitude: number; color: string; popupHtml: string }`、デフォルトエクスポート`LeafletMap({ markers }: { markers: MapMarker[] })`
  - `app/map/MapClientWrapper.tsx`: デフォルトエクスポート`MapClientWrapper({ markers }: { markers: MapMarker[] })`

- [ ] **Step 1: `leaflet`・`@types/leaflet`を依存に追加する**

```bash
npm install leaflet@1.9.4
npm install --save-dev @types/leaflet@1.9.22
```

- [ ] **Step 2: `utils/textNormalize.ts`を作成する**

```ts
export function normalizeVenueName(value: string): string {
  return value.trim().normalize('NFKC')
}
```

- [ ] **Step 3: `app/map/LeafletMap.tsx`を作成する**

```tsx
'use client'

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export type MapMarker = {
  id: string
  latitude: number
  longitude: number
  color: string
  popupHtml: string
}

export default function LeafletMap({ markers }: { markers: MapMarker[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current).setView([35.6812, 139.7671], 5)
    mapRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map)

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const layerGroup = L.layerGroup().addTo(map)

    for (const marker of markers) {
      const icon = L.divIcon({
        className: '',
        html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${marker.color};border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,0.6);"></span>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      })
      L.marker([marker.latitude, marker.longitude], { icon }).addTo(layerGroup).bindPopup(marker.popupHtml)
    }

    if (markers.length > 0) {
      map.fitBounds(layerGroup.getBounds(), { padding: [40, 40], maxZoom: 12 })
    }

    return () => {
      layerGroup.remove()
    }
  }, [markers])

  return <div ref={containerRef} className="h-[600px] w-full rounded-lg" />
}
```

- [ ] **Step 4: `app/map/MapClientWrapper.tsx`を作成する**

```tsx
'use client'

import dynamic from 'next/dynamic'
import type { MapMarker } from './LeafletMap'

const LeafletMap = dynamic(() => import('./LeafletMap'), { ssr: false })

export default function MapClientWrapper({ markers }: { markers: MapMarker[] }) {
  return <LeafletMap markers={markers} />
}
```

- [ ] **Step 5: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 6: `utils/textNormalize.ts`の簡易動作確認**

```bash
npx tsx -e "
import('/Users/th/dev/music-synapse/utils/textNormalize.ts').then((m) => {
  console.log(JSON.stringify(m.normalizeVenueName('  Zepp　Tokyo  ')))
  console.log(JSON.stringify(m.normalizeVenueName('ぴあアリーナＭＭ')))
})
"
```

Expected: 1つ目は`"Zepp Tokyo"`(全角スペースが半角化、前後の空白が除去)、2つ目は`"ぴあアリーナMM"`(全角英字が半角化)相当の結果になる。

- [ ] **Step 7: コミット**

```bash
git add package.json package-lock.json utils/textNormalize.ts app/map/LeafletMap.tsx app/map/MapClientWrapper.tsx
git commit -m "feat: add generic Leaflet map component and venue name normalizer"
```

---

### Task 2: マップページ(データ取得・マーカー構築)

**Files:**
- Create: `app/map/page.tsx`

**Interfaces:**
- Consumes: `MapMarker`(Task 1、`@/app/map/LeafletMap`または相対import)、`MapClientWrapper`(Task 1、`./MapClientWrapper`)、`normalizeVenueName`(Task 1、`@/utils/textNormalize`)。

- [ ] **Step 1: `app/map/page.tsx`を作成する**

```tsx
import { createClient } from '@/utils/Supabase/server'
import { normalizeVenueName } from '@/utils/textNormalize'
import MapClientWrapper from './MapClientWrapper'
import type { MapMarker } from './LeafletMap'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export default async function MapPage() {
  const supabase = await createClient()

  const { data: artists } = await supabase
    .from('artist')
    .select('id, name, image_url, origin_latitude, origin_longitude')
    .not('origin_latitude', 'is', null)
    .not('origin_longitude', 'is', null)

  const artistIds = (artists ?? []).map((a) => a.id)

  const { data: albums } = artistIds.length
    ? await supabase
        .from('album')
        .select('id, artist_id, title, jacket_url, release_date')
        .in('artist_id', artistIds)
        .order('release_date', { ascending: false, nullsFirst: false })
    : { data: [] as { id: string; artist_id: string; title: string; jacket_url: string | null }[] }

  const albumsByArtist = new Map<string, { id: string; title: string; jacketUrl: string | null }[]>()
  for (const album of albums ?? []) {
    const list = albumsByArtist.get(album.artist_id) ?? []
    if (list.length < 3) {
      list.push({ id: album.id, title: album.title, jacketUrl: album.jacket_url })
      albumsByArtist.set(album.artist_id, list)
    }
  }

  const artistMarkers: MapMarker[] = (artists ?? [])
    .filter((a) => a.origin_latitude != null && a.origin_longitude != null)
    .map((a) => {
      const albumsHtml = (albumsByArtist.get(a.id) ?? [])
        .map(
          (album) =>
            `<div style="margin-top:4px;font-size:12px;">${
              album.jacketUrl
                ? `<img src="${escapeHtml(album.jacketUrl)}" alt="" style="width:32px;height:32px;object-fit:cover;border-radius:4px;vertical-align:middle;margin-right:4px;" />`
                : ''
            }${escapeHtml(album.title)}</div>`
        )
        .join('')
      return {
        id: `artist-${a.id}`,
        latitude: Number(a.origin_latitude),
        longitude: Number(a.origin_longitude),
        color: '#e85d5d',
        popupHtml: `<div style="min-width:160px;">${
          a.image_url
            ? `<img src="${escapeHtml(a.image_url)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:50%;" />`
            : ''
        }<div style="margin-top:4px;font-weight:bold;"><a href="/artists/${a.id}" style="color:inherit;">${escapeHtml(
          a.name
        )}</a></div>${albumsHtml}</div>`,
      }
    })

  const { data: venueLocations } = await supabase.from('venue_location').select('id, venue_name, latitude, longitude')

  const [{ data: musicEvents }, { data: eventEditions }, { data: eventAppearances }] = await Promise.all([
    supabase.from('music_event').select('id, name, venue, artist_id'),
    supabase.from('event_edition').select('id, event_id, year, venue, event:event_id(name)'),
    supabase
      .from('event_appearance')
      .select('id, venue, event_edition:event_edition_id(id, event_id, year, event:event_id(name))'),
  ])

  type VenueEventLink = { label: string; href: string }

  function eventsForVenue(normalizedName: string): VenueEventLink[] {
    const links: VenueEventLink[] = []

    for (const row of musicEvents ?? []) {
      if (row.venue && normalizeVenueName(row.venue) === normalizedName) {
        links.push({ label: row.name, href: `/artists/${row.artist_id}` })
      }
    }

    for (const row of eventEditions ?? []) {
      if (row.venue && normalizeVenueName(row.venue) === normalizedName) {
        const event = Array.isArray(row.event) ? row.event[0] : row.event
        links.push({
          label: `${event?.name ?? '?'}(${row.year})`,
          href: `/events/${row.event_id}?year=${row.year}`,
        })
      }
    }

    for (const row of eventAppearances ?? []) {
      if (!row.venue || normalizeVenueName(row.venue) !== normalizedName) continue
      const edition = Array.isArray(row.event_edition) ? row.event_edition[0] : row.event_edition
      if (!edition) continue
      const event = Array.isArray(edition.event) ? edition.event[0] : edition.event
      links.push({
        label: `${event?.name ?? '?'}(${edition.year})`,
        href: `/events/${edition.event_id}?year=${edition.year}`,
      })
    }

    return links
  }

  const venueMarkers: MapMarker[] = (venueLocations ?? []).map((v) => {
    const normalizedName = normalizeVenueName(v.venue_name)
    const links = eventsForVenue(normalizedName)
    const linksHtml =
      links.length > 0
        ? links
            .map(
              (l) =>
                `<div style="margin-top:4px;font-size:12px;"><a href="${escapeHtml(l.href)}">${escapeHtml(
                  l.label
                )}</a></div>`
            )
            .join('')
        : '<div style="margin-top:4px;font-size:12px;color:#888;">開催イベント情報なし</div>'
    return {
      id: `venue-${v.id}`,
      latitude: Number(v.latitude),
      longitude: Number(v.longitude),
      color: '#5aa9e6',
      popupHtml: `<div style="min-width:160px;"><div style="font-weight:bold;">${escapeHtml(
        v.venue_name
      )}</div>${linksHtml}</div>`,
    }
  })

  const markers: MapMarker[] = [...artistMarkers, ...venueMarkers]

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-2xl font-bold">マップ</h1>
      <p className="mt-2 text-sm text-white/50">
        アーティストの出身地・結成地(赤)とイベント会場(青)を地図で表示します。
      </p>
      <div className="mt-8">
        <MapClientWrapper markers={markers} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: 開発サーバーで実機確認**

1. `/map`をブラウザで開き、地図(OpenStreetMapタイル)が表示され、パン・ズームが正常に動作することを確認する
2. 赤いピン(アーティスト)が実データの数(現時点で座標が入っている13件)だけ表示されることを確認する
3. 赤いピンをクリックし、画像・名前・代表アルバム(最大3件、ジャケット画像付き)がポップアップ表示され、名前クリックで対応する`/artists/[id]`に正しく遷移することを確認する
4. 青いピン(会場)をクリックし、会場名と開催イベント一覧(またはイベント情報なしの表示)がポップアップ表示されることを確認する。実データの会場(新潟県湯沢町苗場スキー場)が、対応するイベントと正しく紐付いているか確認する(紐付くイベントデータが実際に存在するか事前にSupabase MCPで確認してから判断してよい)
5. 会場ポップアップ内のイベントリンクをクリックし、`event_edition`由来なら`/events/[event_id]?year=[year]`に、`music_event`由来なら対応する`/artists/[artist_id]`に正しく遷移することを確認する
6. 全角/半角の表記揺れがある会場名の実データがあれば、正規化後も正しく突き合わせできていることを確認する(無ければこのケースはTask 1 Step 6のユニットレベルの確認で代替してよい)

- [ ] **Step 4: コミット**

```bash
git add app/map/page.tsx
git commit -m "feat: add /map page with artist and venue markers"
```

---

## Self-Review Notes

- **Spec coverage:** ゴール5点(アーティスト+会場ピンの色分け表示、実地図、アーティストポップアップ、会場ポップアップ、会場名の正規化)をTask 1〜2でカバー。非ゴール(座標データの追加収集、高度な名寄せ、フィルタリング機能、モバイル最適化の作り込み)はいずれも実装していない。新規テーブル・カラムは無し。
- **Placeholder scan:** なし。全ステップに実コードを記載。
- **Type consistency:** `MapMarker`型(Task 1)のフィールド名(`id`/`latitude`/`longitude`/`color`/`popupHtml`)はTask 2の`artistMarkers`/`venueMarkers`構築ロジックで一貫して使用。`/events/[id]`のURL規約(`event_id`をパスに、`year`をクエリに)はGlobal ConstraintsとTask 2のコードで一致。
