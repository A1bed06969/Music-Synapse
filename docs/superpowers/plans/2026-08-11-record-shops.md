# レコードショップ情報収集(手動登録+地図表示) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** レコードショップを管理画面から手動で1件ずつ登録し、`/map`ページに3種類目のピン(緑)として表示できるようにする。

**Architecture:** 既存の`recordshop`テーブル(0行、先行スキャフォールド済み)に`hours`/`source`列を追加し、`app/admin/data/venues/`と同じ「住所をNominatimでジオコーディング→候補から選んで確定」パターンで`app/admin/data/shops/`を新設する。`/map`ページは既存のマーカー配列に`recordshop`由来のマーカーを追加するだけで、`LeafletMap.tsx`はドメイン非依存のため変更不要。

**Tech Stack:** Next.js 16 App Router (Server Actions), Supabase, Nominatim (OpenStreetMap) ジオコーディングAPI

このプロジェクトに自動テストフレームワークは無い(`package.json`にjest/vitest等が無い)。既存の`app/map/`実装と同じく、各タスクの検証は`npx tsc --noEmit`と実機(ブラウザ)確認で行う。

## Global Constraints

- 新規テーブルは作らない。既存の`recordshop`テーブル(列: `id`, `name`, `country`, `prefecture_or_state`, `city`, `address`, `latitude`, `longitude`, `official_site_url`, `created_at`)を拡張して使う。
- `source`列の値は`venue_location.source`の命名慣習に合わせ、`'manual'`ではなく`'nominatim'`(座標取得手段を表す)とする。
- `country`/`prefecture_or_state`/`city`はユーザーに個別入力させず、Nominatimのジオコーディング結果(`addressdetails=1`)から自動的に埋める。
- Overpass APIによる一括収集、営業時間の構造化、店舗の編集・削除UI、レコードショップ専用の一覧・詳細ページは非ゴール(このプランのスコープ外)。
- Nominatim/MusicBrainz等の外部APIは1req/秒のレート制限を守る(既存の`utils/nominatim.ts`の`sleep(1000)`を踏襲)。

---

### Task 1: `recordshop`テーブルに`hours`/`source`列を追加

**Files:**
- なし(コード変更ではなく、Supabase MCPツールでのDBマイグレーション)

**Interfaces:**
- Produces: `recordshop`テーブルに`hours text`(nullable)と`source text not null default 'nominatim'`の2列が追加された状態。Task 3以降のinsert文がこの2列を書き込む前提。

- [ ] **Step 1: マイグレーションを適用**

`mcp__claude_ai_Supabase__apply_migration`ツールで以下を実行する(project_id: `ftvhglfthbcxhgnoninv`):

```sql
alter table recordshop add column hours text;
alter table recordshop add column source text not null default 'nominatim';
```

- [ ] **Step 2: 列が追加されたことを確認**

`mcp__claude_ai_Supabase__list_tables`(verbose: true)で`public.recordshop`の`columns`に`hours`(nullable text)と`source`(not null text, default `'nominatim'::text`)が含まれることを確認する。

- [ ] **Step 3: コミット**

コード変更が無いため、このタスクではgitコミットは不要(Task 3のコミットに含めて記録する)。

---

### Task 2: `utils/nominatim.ts`を拡張し、構造化住所(国・都道府県・市区町村)を返せるようにする

**Files:**
- Modify: `utils/nominatim.ts`

**Interfaces:**
- Consumes: なし(既存ファイルの拡張のみ)
- Produces: `NominatimResult`型に`country: string | null`, `prefectureOrState: string | null`, `city: string | null`を追加した`geocodeVenue(query: string): Promise<NominatimResult[]>`。既存の呼び出し元(`app/admin/data/venues/page.tsx`)は追加フィールドを読まないため互換性は保たれる。

- [ ] **Step 1: `NominatimResult`型とNominatim呼び出しを拡張**

`utils/nominatim.ts`を以下の内容に置き換える:

```ts
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type NominatimResult = {
  latitude: number
  longitude: number
  displayName: string
  country: string | null
  prefectureOrState: string | null
  city: string | null
}

export async function geocodeVenue(venueName: string): Promise<NominatimResult[]> {
  await sleep(1000)
  const url = `${NOMINATIM_BASE}?q=${encodeURIComponent(venueName)}&format=json&addressdetails=1&limit=5`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) {
    throw new Error(`Nominatim API error: ${res.status}`)
  }
  const data = await res.json()
  return (data ?? []).map((r: any) => ({
    latitude: Number(r.lat),
    longitude: Number(r.lon),
    displayName: r.display_name,
    // Nominatimは国によって都道府県相当の階層をstateまたはprovinceの
    // どちらかで返す(日本はprovince)。市区町村もcity/town/suburbに
    // ばらつく(政令指定都市の区はsuburbに入ることがある)。
    country: r.address?.country ?? null,
    prefectureOrState: r.address?.state ?? r.address?.province ?? null,
    city: r.address?.city ?? r.address?.town ?? r.address?.suburb ?? null,
  }))
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラー無し

- [ ] **Step 3: コミット**

```bash
git add utils/nominatim.ts
git commit -m "feat: return structured address (country/prefecture/city) from Nominatim geocoding"
```

---

### Task 3: レコードショップ登録用の管理画面を新設

**Files:**
- Create: `app/admin/data/shops/actions.ts`
- Create: `app/admin/data/shops/SubmitButton.tsx`
- Create: `app/admin/data/shops/page.tsx`
- Modify: `app/admin/data/page.tsx:192-202`(ナビリンク追加)

**Interfaces:**
- Consumes: `geocodeVenue(query: string): Promise<NominatimResult[]>`(Task 2, `utils/nominatim.ts`)。`NominatimResult`は`latitude`/`longitude`/`displayName`/`country`/`prefectureOrState`/`city`を持つ。また、`recordshop`テーブルに`hours`(text, null許容)と`source`(text, not null)列が存在すること(Task 1で追加済み)。
- Produces: `importRecordShop(formData: FormData)` server action(`app/admin/data/shops/actions.ts`からexport)。`recordshop`にinsertする。Task 4はこのタスクを消費しない(独立)。

- [ ] **Step 1: Server Actionを作成**

`app/admin/data/shops/actions.ts`を作成:

```ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'

export async function importRecordShop(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const address = String(formData.get('address') ?? '').trim()
  const officialSiteUrl = String(formData.get('official_site_url') ?? '').trim()
  const hours = String(formData.get('hours') ?? '').trim()
  const country = String(formData.get('country') ?? '').trim()
  const prefectureOrState = String(formData.get('prefecture_or_state') ?? '').trim()
  const city = String(formData.get('city') ?? '').trim()
  const latitudeRaw = formData.get('latitude')
  const longitudeRaw = formData.get('longitude')

  if (!name || latitudeRaw === null || longitudeRaw === null) {
    redirect('/admin/data/shops')
  }

  const latitude = Number(latitudeRaw)
  const longitude = Number(longitudeRaw)

  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    redirect('/admin/data/shops')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('recordshop').insert({
    name,
    address: address || null,
    official_site_url: officialSiteUrl || null,
    hours: hours || null,
    country: country || null,
    prefecture_or_state: prefectureOrState || null,
    city: city || null,
    latitude,
    longitude,
    source: 'nominatim',
  })

  if (error) {
    redirect(`/admin/data/shops?error=${encodeURIComponent(`保存に失敗しました: ${error.message}`)}`)
  }

  revalidatePath('/admin/data/shops')
  revalidatePath('/map')
  redirect(`/admin/data/shops?success=${encodeURIComponent(`「${name}」を登録しました。`)}`)
}
```

- [ ] **Step 2: 送信ボタンコンポーネントを作成**

`app/admin/data/shops/SubmitButton.tsx`を作成:

```tsx
'use client'

import { useFormStatus } from 'react-dom'

export default function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-white/15 px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-40"
    >
      {pending ? '保存中...' : 'この座標で登録'}
    </button>
  )
}
```

- [ ] **Step 3: 登録ページを作成**

`app/admin/data/shops/page.tsx`を作成:

```tsx
import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { geocodeVenue } from '@/utils/nominatim'
import { importRecordShop } from './actions'
import SubmitButton from './SubmitButton'

const inputClass =
  'w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none'
const buttonClass = 'rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85'

export default async function ShopsPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string; address?: string; url?: string; hours?: string; success?: string; error?: string }>
}) {
  const { name, address, url, hours, success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  const { data: shops } = await supabase
    .from('recordshop')
    .select('id, name, address, city, prefecture_or_state')
    .order('name')

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">レコードショップの登録</h1>

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      {name && address ? (
        <ShopCandidates name={name} address={address} url={url ?? ''} hours={hours ?? ''} />
      ) : (
        <form action="/admin/data/shops" className="mt-8 space-y-2">
          <input name="name" placeholder="店名(例: バナナレコード 大阪梅田店)" required className={inputClass} />
          <input name="address" placeholder="住所" required className={inputClass} />
          <input name="url" placeholder="公式サイトURL(任意)" className={inputClass} />
          <input name="hours" placeholder="営業時間(任意。例: 11:00〜20:00)" className={inputClass} />
          <button type="submit" className={buttonClass}>
            住所から座標を検索
          </button>
        </form>
      )}

      {shops && shops.length > 0 && (
        <div className="mt-10 border-t border-white/10 pt-6">
          <h2 className="text-sm font-semibold text-white/70">登録済み店舗</h2>
          <ul className="mt-3 space-y-1 text-sm text-white/60">
            {shops.map((s) => (
              <li key={s.id}>
                {s.name}
                <span className="text-white/30">
                  {' '}
                  ({[s.prefecture_or_state, s.city].filter(Boolean).join(' ') || s.address || '住所不明'})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

async function ShopCandidates({
  name,
  address,
  url,
  hours,
}: {
  name: string
  address: string
  url: string
  hours: string
}) {
  let results
  try {
    results = await geocodeVenue(address)
  } catch (err) {
    console.error('Nominatim検索に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">検索に失敗しました。</p>
  }

  if (results.length === 0) {
    return <p className="mt-8 text-sm text-white/40">該当する候補が見つかりませんでした。</p>
  }

  return (
    <div className="mt-8">
      <Link href="/admin/data/shops" prefetch={false} className="text-xs text-white/40 hover:text-white/70">
        ← 入力し直す
      </Link>

      <div className="mt-4 space-y-2">
        {results.map((r, i) => (
          <form
            key={i}
            action={importRecordShop}
            className="flex items-center justify-between gap-3 rounded-md border border-white/15 px-4 py-3 text-sm"
          >
            <input type="hidden" name="name" value={name} />
            <input type="hidden" name="address" value={address} />
            <input type="hidden" name="official_site_url" value={url} />
            <input type="hidden" name="hours" value={hours} />
            <input type="hidden" name="country" value={r.country ?? ''} />
            <input type="hidden" name="prefecture_or_state" value={r.prefectureOrState ?? ''} />
            <input type="hidden" name="city" value={r.city ?? ''} />
            <input type="hidden" name="latitude" value={r.latitude} />
            <input type="hidden" name="longitude" value={r.longitude} />
            <span>{r.displayName}</span>
            <SubmitButton />
          </form>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 管理画面トップにナビリンクを追加**

`app/admin/data/page.tsx`の192〜202行目を以下に置き換える:

```tsx
        <div className="flex gap-3">
          <Link href="/admin/data/shops" className="text-xs text-white/40 hover:text-white/70">
            レコードショップ登録
          </Link>
          <Link href="/admin/data/venues" className="text-xs text-white/40 hover:text-white/70">
            会場の座標登録
          </Link>
          <Link href="/admin/data/artists/geo" className="text-xs text-white/40 hover:text-white/70">
            アーティスト座標を一括更新
          </Link>
          <Link href="/admin/import" className="text-xs text-white/40 hover:text-white/70">
            iTunes一括登録へ →
          </Link>
        </div>
```

- [ ] **Step 5: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラー無し

- [ ] **Step 6: 実機確認**

開発サーバーを起動し、`/admin/data/shops`にアクセス。フォームに以下を入力して送信する:
- 店名: `バナナレコード 大阪梅田店`
- 住所: `大阪市北区芝田2丁目1-3 梅仙堂ビル3F`
- 公式サイトURL・営業時間: 任意入力(分かる範囲でよい)

候補が表示されることを確認し、いずれかを選んで「この座標で登録」をクリック。成功メッセージが出て、ページ下部の「登録済み店舗」一覧に表示されることを確認する。

- [ ] **Step 7: コミット**

```bash
git add app/admin/data/shops app/admin/data/page.tsx
git commit -m "feat: add manual record shop registration admin page"
```

---

### Task 4: `/map`ページにレコードショップのピンを追加

**Files:**
- Modify: `app/map/page.tsx`

**Interfaces:**
- Consumes: `MapMarker`型(`app/map/LeafletMap.tsx`で定義済み、`{ id, latitude, longitude, color, popupHtml }`)。`LeafletMap`コンポーネント自体はドメイン非依存のため変更不要。`recordshop`テーブルの`id`/`name`/`address`/`official_site_url`/`hours`/`latitude`/`longitude`列(`hours`はTask 1で追加)。
- Produces: なし(最終タスク)

- [ ] **Step 1: レコードショップのマーカーを追加**

`app/map/page.tsx`の`const venueMarkers: MapMarker[] = ...`ブロックの直後(現在149行目の`const markers: MapMarker[] = [...artistMarkers, ...venueMarkers]`の直前)に以下を追加し、`markers`の組み立てを書き換える:

```tsx
  const { data: recordShops } = await supabase
    .from('recordshop')
    .select('id, name, address, official_site_url, hours, latitude, longitude')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)

  const shopMarkers: MapMarker[] = (recordShops ?? []).map((s) => {
    const detailsHtml = [
      s.address ? `<div style="font-size:12px;color:#aaa;">${escapeHtml(s.address)}</div>` : '',
      s.hours ? `<div style="margin-top:2px;font-size:12px;">${escapeHtml(s.hours)}</div>` : '',
      s.official_site_url
        ? `<div style="margin-top:4px;font-size:12px;"><a href="${escapeHtml(s.official_site_url)}">公式サイト</a></div>`
        : '',
    ].join('')
    return {
      id: `shop-${s.id}`,
      latitude: Number(s.latitude),
      longitude: Number(s.longitude),
      color: '#5ad66f',
      popupHtml: `<div style="min-width:160px;"><div style="font-weight:bold;">${escapeHtml(s.name)}</div>${detailsHtml}</div>`,
    }
  })

  const markers: MapMarker[] = [...artistMarkers, ...venueMarkers, ...shopMarkers]
```

`const markers: MapMarker[] = [...artistMarkers, ...venueMarkers]`という既存の行は上記の新しい行で置き換える(重複させない)。

- [ ] **Step 2: 凡例文言を更新**

`app/map/page.tsx`内の以下の行:

```tsx
        アーティストの出身地・結成地(赤)とイベント会場(青)を地図で表示します。
```

を以下に置き換える:

```tsx
        アーティストの出身地・結成地(赤)、イベント会場(青)、レコードショップ(緑)を地図で表示します。
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラー無し

- [ ] **Step 4: 実機確認**

`/map`を開き、Task 3で登録したバナナレコード大阪梅田店の緑ピンが大阪梅田付近に表示されることを確認する。ピンをクリックし、店名・住所・営業時間(入力していれば)・公式サイトリンク(入力していれば)がポップアップに表示されることを確認する。未入力の項目については該当行が表示されないことも確認する。

- [ ] **Step 5: コミット**

```bash
git add app/map/page.tsx
git commit -m "feat: show record shops as green pins on the map"
```
