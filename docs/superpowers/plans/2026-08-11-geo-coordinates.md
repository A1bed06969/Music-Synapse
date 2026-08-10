# 座標データ収集(出生地・結成地・会場) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アーティストの出生地/結成地とイベント会場の座標を、Wikidata・OpenStreetMap Nominatimから収集して`artist`/`venue_location`に反映する(地図UI自体は別プラン)。

**Architecture:** `utils/wikidata.ts`(検索+SPARQLでの座標解決)と`utils/nominatim.ts`(会場名のジオコーディング)を新設。Wikidata IDが既知のアーティスト(確度が高い)は管理画面から一括自動反映、未知のアーティストと会場名(確度が低い)は検索→候補確認→取り込みの人間確認フローとする。

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Supabase(`@supabase/ssr`で読み取り、`createAdminClient`のservice_roleクライアントで書き込み)、Tailwind CSS v4、Wikidata API(認証不要)、OpenStreetMap Nominatim API(認証不要、要User-Agent、1req/秒)。

## Global Constraints

- **DBマイグレーションは適用済み。新規タスクを作らないこと。** Supabaseプロジェクト`ftvhglfthbcxhgnoninv`に以下が適用済み:
  - `artist`テーブルに`origin_latitude numeric`・`origin_longitude numeric`列を追加(個人アーティストなら出生地、グループなら結成地の座標。1アーティスト1点)。
  - `venue_location`テーブル新規作成(`id text primary key default generate_ms_id('VLC')`, `venue_name text not null`, `latitude numeric not null`, `longitude numeric not null`, `source text not null`, `created_at timestamptz not null default now()`)。ユニークインデックス`venue_location_name_key`が`venue_name`に存在。RLS有効化済み、`public`ロールに`select`のみ許可する`"Public read access"`ポリシー適用済み(書き込みはservice_roleのみ)。既存の`music_event`/`event_edition`/`event_appearance`テーブルの`venue`列(自由入力text)は変更しない。地図構築時に`venue`文字列と`venue_location.venue_name`を突き合わせる方式。
- Wikidata/Nominatimへのリクエストはこのプランの新規ユーティリティ内で必ずリクエスト間隔を空けること(Wikidata検索・SPARQLは300ms、Nominatimは1000ms — Nominatimの利用規約で1req/秒が明記されているため厳守)。`User-Agent`ヘッダーは既存のMusicBrainzクライアントと同じ値`'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'`を使う。
- Wikidataの座標取得は`wdt:P19`(出生地、個人向け)と`wdt:P740`(結成地、グループ向け)の両方を1クエリで試し(`wdt:P19|wdt:P740`)、見つかった方の場所エンティティの`wdt:P625`(座標)を返す。座標が無ければ`null`を返し、呼び出し側は「座標データなし」として扱う(エラーではない)。
- SPARQLクエリが返す座標値は`"Point(経度 緯度)"`という文字列形式(実データで確認済み、経度が先)。パース時にこの順序を間違えないこと。
- 会場の座標登録(`venue_location`への書き込み)は`.upsert(..., { onConflict: 'venue_name', ignoreDuplicates: true })`を使うこと(重複防止インデックスと厳密に一致させる)。
- 外部APIへの通信失敗・候補0件・座標データなしは、それぞれ個別にメッセージを表示し、他のアーティスト/会場の処理は継続する(一括処理の場合)。
- 検索結果からのリンク・詳細プレビューへのリンクなど、遷移先で外部API(Wikidata/Nominatim)を呼び出すページへの`<Link>`には必ず`prefetch={false}`を付けること(Next.js本番ビルドのプリフェッチが意図しない外部API呼び出しを引き起こす既知の問題への対処、このプロジェクトの既存機能で確立済みの方針)。一覧ページ自体(DBの読み取りのみ、外部APIを呼ばない)へのナビゲーションリンクは対象外(prefetchしてよい)。
- 自動テストは追加しない。検証は`npx tsc --noEmit`と実機確認(Ado=個人・出生地あり、King Gnu=グループ・結成地データなし、実在の会場1件)で行う。

---

### Task 1: Wikidata・Nominatimクライアント

**Files:**
- Create: `utils/wikidata.ts`
- Create: `utils/nominatim.ts`

**Interfaces:**
- Produces:
  - `utils/wikidata.ts`: `export type WikidataSearchResult = { qid: string; label: string; description: string | null }`、`export async function searchWikidataEntity(name: string): Promise<WikidataSearchResult[]>`、`export type WikidataOriginCoordinates = { latitude: number; longitude: number; placeLabel: string }`、`export async function fetchOriginCoordinates(qid: string): Promise<WikidataOriginCoordinates | null>`
  - `utils/nominatim.ts`: `export type NominatimResult = { latitude: number; longitude: number; displayName: string }`、`export async function geocodeVenue(venueName: string): Promise<NominatimResult[]>`

- [ ] **Step 1: `utils/wikidata.ts`を作成する**

```ts
const WIKIDATA_API_BASE = 'https://www.wikidata.org/w/api.php'
const WIKIDATA_SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql'
const USER_AGENT = 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type WikidataSearchResult = {
  qid: string
  label: string
  description: string | null
}

export async function searchWikidataEntity(name: string): Promise<WikidataSearchResult[]> {
  await sleep(300)
  const url = `${WIKIDATA_API_BASE}?action=wbsearchentities&search=${encodeURIComponent(name)}&language=ja&format=json&limit=5`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) {
    throw new Error(`Wikidata API error (search): ${res.status}`)
  }
  const data = await res.json()
  return (data.search ?? []).map((r: any) => ({
    qid: r.id,
    label: r.label ?? r.id,
    description: r.description ?? null,
  }))
}

export type WikidataOriginCoordinates = {
  latitude: number
  longitude: number
  placeLabel: string
}

export async function fetchOriginCoordinates(qid: string): Promise<WikidataOriginCoordinates | null> {
  await sleep(300)
  const query = `SELECT ?place ?placeLabel ?coord WHERE { wd:${qid} wdt:P19|wdt:P740 ?place . ?place wdt:P625 ?coord . SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". } } LIMIT 1`
  const url = `${WIKIDATA_SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
  if (!res.ok) {
    throw new Error(`Wikidata API error (SPARQL): ${res.status}`)
  }
  const data = await res.json()
  const binding = data.results?.bindings?.[0]
  if (!binding) return null

  const coordValue: string | undefined = binding.coord?.value
  if (!coordValue) return null

  // "Point(経度 緯度)" 形式(実データで確認済み、経度が先)
  const match = coordValue.match(/Point\(([-\d.]+) ([-\d.]+)\)/)
  if (!match) return null

  return {
    longitude: Number(match[1]),
    latitude: Number(match[2]),
    placeLabel: binding.placeLabel?.value ?? '',
  }
}
```

- [ ] **Step 2: `utils/nominatim.ts`を作成する**

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
}

export async function geocodeVenue(venueName: string): Promise<NominatimResult[]> {
  await sleep(1000)
  const url = `${NOMINATIM_BASE}?q=${encodeURIComponent(venueName)}&format=json&limit=5`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) {
    throw new Error(`Nominatim API error: ${res.status}`)
  }
  const data = await res.json()
  return (data ?? []).map((r: any) => ({
    latitude: Number(r.lat),
    longitude: Number(r.lon),
    displayName: r.display_name,
  }))
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: 実データでの動作確認**

```bash
npx tsx -e "
import('/Users/th/dev/music-synapse/utils/wikidata.ts').then(async (m) => {
  const search = await m.searchWikidataEntity('米津玄師')
  console.log('search:', JSON.stringify(search, null, 2))
  const adoCoords = await m.fetchOriginCoordinates('Q104012678')
  console.log('Ado(個人・出生地あり):', JSON.stringify(adoCoords, null, 2))
  const kingGnuCoords = await m.fetchOriginCoordinates('Q48760263')
  console.log('King Gnu(グループ・結成地データなし):', JSON.stringify(kingGnuCoords, null, 2))
})
"
npx tsx -e "
import('/Users/th/dev/music-synapse/utils/nominatim.ts').then(async (m) => {
  const results = await m.geocodeVenue('東京ドーム')
  console.log(JSON.stringify(results, null, 2))
})
"
```

Expected: `searchWikidataEntity`が米津玄師の候補を返す。Adoの座標が`{ latitude: 35.68944..., longitude: 139.69166..., placeLabel: '東京都' }`相当で返る。King Gnuは`null`が返る(結成地データがWikidataに無いため)。Nominatimの結果に東京ドームの座標(緯度35.7付近、経度139.75付近)が含まれる。

- [ ] **Step 5: コミット**

```bash
git add utils/wikidata.ts utils/nominatim.ts
git commit -m "feat: add Wikidata and Nominatim clients for geo coordinate lookup"
```

---

### Task 2: アーティスト座標の一括自動更新(Wikidata ID既知分)

**Files:**
- Create: `app/admin/data/artists/geo/page.tsx`
- Create: `app/admin/data/artists/geo/actions.ts`
- Create: `app/admin/data/artists/geo/SubmitButton.tsx`
- Modify: `app/admin/data/page.tsx:188-195`(ナビゲーションリンク追加)

**Interfaces:**
- Consumes: `fetchOriginCoordinates`(Task 1、`@/utils/wikidata`)。
- Produces: `runBulkOriginUpdate(): Promise<void>`(サーバーアクション、引数無し)。

- [ ] **Step 1: `app/admin/data/artists/geo/SubmitButton.tsx`を作成する**

```tsx
'use client'

import { useFormStatus } from 'react-dom'

export default function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85 disabled:opacity-40"
    >
      {pending ? '更新中...' : '一括更新を実行'}
    </button>
  )
}
```

- [ ] **Step 2: `app/admin/data/artists/geo/actions.ts`を作成する**

```ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchOriginCoordinates } from '@/utils/wikidata'

export async function runBulkOriginUpdate() {
  const supabase = createAdminClient()

  const { data: wikidataLinks } = await supabase
    .from('artist_external_link')
    .select('artist_id, url, artist:artist_id(id, name, origin_latitude)')
    .eq('link_type', 'wikidata')

  const eligible = (wikidataLinks ?? [])
    .map((l) => {
      const artist = Array.isArray(l.artist) ? l.artist[0] : l.artist
      if (!artist || artist.origin_latitude != null) return null
      return { artistId: artist.id as string, name: artist.name as string, url: l.url as string }
    })
    .filter((v): v is { artistId: string; name: string; url: string } => v !== null)

  let updated = 0
  let notFound = 0
  let failed = 0

  for (const { artistId, name, url } of eligible) {
    const qidMatch = url.match(/\/(Q\d+)$/)
    if (!qidMatch) {
      failed += 1
      continue
    }
    const qid = qidMatch[1]

    let coords
    try {
      coords = await fetchOriginCoordinates(qid)
    } catch (err) {
      console.error(`Wikidata座標取得に失敗しました(${name}):`, err)
      failed += 1
      continue
    }

    if (!coords) {
      notFound += 1
      continue
    }

    const { error } = await supabase
      .from('artist')
      .update({ origin_latitude: coords.latitude, origin_longitude: coords.longitude })
      .eq('id', artistId)
    if (error) {
      console.error(`座標の保存に失敗しました(${name}):`, error)
      failed += 1
      continue
    }
    updated += 1
  }

  revalidatePath('/admin/data/artists/geo')

  const message = `更新${updated}件・座標データなし${notFound}件・失敗${failed}件`
  if (updated === 0 && failed > 0) {
    redirect(`/admin/data/artists/geo?error=${encodeURIComponent(message)}`)
  }
  redirect(`/admin/data/artists/geo?success=${encodeURIComponent(message)}`)
}
```

- [ ] **Step 3: `app/admin/data/artists/geo/page.tsx`を作成する**

```tsx
import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { runBulkOriginUpdate } from './actions'
import SubmitButton from './SubmitButton'

export default async function ArtistGeoPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  const { data: wikidataLinks } = await supabase
    .from('artist_external_link')
    .select('artist_id, artist:artist_id(id, origin_latitude)')
    .eq('link_type', 'wikidata')

  const eligibleCount = (wikidataLinks ?? []).filter((l) => {
    const artist = Array.isArray(l.artist) ? l.artist[0] : l.artist
    return artist && artist.origin_latitude == null
  }).length

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">アーティスト座標の一括更新</h1>
      <p className="mt-2 text-sm text-white/50">
        Wikidata IDが登録済みで、まだ座標が未設定のアーティスト{eligibleCount}件が対象です。
      </p>

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      {eligibleCount === 0 ? (
        <p className="mt-8 text-sm text-white/40">対象のアーティストはいません。</p>
      ) : (
        <form action={runBulkOriginUpdate} className="mt-8">
          <SubmitButton />
        </form>
      )}
    </div>
  )
}
```

- [ ] **Step 4: `app/admin/data/page.tsx`にナビゲーションリンクを追加する**

現在の188〜195行目:

```tsx
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">手動データ登録</h1>
        <Link href="/admin/import" className="text-xs text-white/40 hover:text-white/70">
          iTunes一括登録へ →
        </Link>
      </div>
```

を次のように変更する:

```tsx
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">手動データ登録</h1>
        <div className="flex gap-3">
          <Link href="/admin/data/artists/geo" className="text-xs text-white/40 hover:text-white/70">
            アーティスト座標を一括更新
          </Link>
          <Link href="/admin/import" className="text-xs text-white/40 hover:text-white/70">
            iTunes一括登録へ →
          </Link>
        </div>
      </div>
```

- [ ] **Step 5: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 6: 開発サーバーで実機確認**

1. `/admin/data`から「アーティスト座標を一括更新」リンクで`/admin/data/artists/geo`に遷移し、対象件数が表示されることを確認
2. 「一括更新を実行」を押し、成功メッセージ(更新件数・座標データなし件数・失敗件数)が表示されることを確認
3. Supabase MCPの`execute_sql`で`select id, name, origin_latitude, origin_longitude from artist where musicbrainz_id is not null and origin_latitude is not null`を実行し、Adoの座標が東京都相当(緯度35.68付近、経度139.69付近)で入っていることを確認。King Gnuは対象になっていない(Wikidata側に結成地データが無いため`origin_latitude`が`null`のまま)ことを確認
4. 再度「一括更新を実行」を押し、対象件数が0件になっている(全て処理済みのため)ことを確認

- [ ] **Step 7: コミット**

```bash
git add app/admin/data/artists/geo app/admin/data/page.tsx
git commit -m "feat: add bulk artist origin coordinate update from Wikidata"
```

---

### Task 3: アーティスト座標の個別検索(Wikidata ID未知分)

**Files:**
- Create: `app/admin/data/artists/[id]/geo-search/page.tsx`
- Create: `app/admin/data/artists/[id]/geo-search/actions.ts`
- Create: `app/admin/data/artists/[id]/geo-search/SubmitButton.tsx`
- Modify: `app/admin/data/artists/[id]/edit/page.tsx:35-49`(ナビゲーションリンク追加)

**Interfaces:**
- Consumes: `searchWikidataEntity`, `fetchOriginCoordinates`, `WikidataSearchResult`(Task 1、`@/utils/wikidata`)。
- Produces: `importOriginCoordinates(formData: FormData): Promise<void>`(サーバーアクション)。

- [ ] **Step 1: `app/admin/data/artists/[id]/geo-search/SubmitButton.tsx`を作成する**

```tsx
'use client'

import { useFormStatus } from 'react-dom'

export default function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85 disabled:opacity-40"
    >
      {pending ? '保存中...' : 'この座標を保存する'}
    </button>
  )
}
```

- [ ] **Step 2: `app/admin/data/artists/[id]/geo-search/actions.ts`を作成する**

```ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'

function redirectWith(artistId: string, result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/artists/${artistId}/geo-search?${result}=${encodeURIComponent(message)}`)
}

export async function importOriginCoordinates(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')
  const latitude = Number(formData.get('latitude') ?? '')
  const longitude = Number(formData.get('longitude') ?? '')

  if (!artistId || Number.isNaN(latitude) || Number.isNaN(longitude)) {
    redirect('/admin/data')
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('artist')
    .update({ origin_latitude: latitude, origin_longitude: longitude })
    .eq('id', artistId)

  if (error) {
    redirectWith(artistId, 'error', `座標の保存に失敗しました: ${error.message}`)
  }

  revalidatePath(`/admin/data/artists/${artistId}/edit`)
  redirectWith(artistId, 'success', '座標を保存しました。')
}
```

- [ ] **Step 3: `app/admin/data/artists/[id]/geo-search/page.tsx`を作成する**

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { searchWikidataEntity, fetchOriginCoordinates } from '@/utils/wikidata'
import { importOriginCoordinates } from './actions'
import SubmitButton from './SubmitButton'

export default async function ArtistGeoSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ qid?: string; success?: string; error?: string }>
}) {
  const { id } = await params
  const { qid, success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  const { data: artist, error } = await supabase.from('artist').select('id, name').eq('id', id).single()

  if (error || !artist) {
    notFound()
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href={`/admin/data/artists/${id}/edit`} className="text-xs text-white/40 hover:text-white/70">
        ← {artist.name} の編集に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{artist.name} の座標をWikidataで検索</h1>

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      {qid ? (
        <CoordinatesPreview artistId={id} qid={qid} />
      ) : (
        <SearchResults artistId={id} artistName={artist.name} />
      )}
    </div>
  )
}

async function SearchResults({ artistId, artistName }: { artistId: string; artistName: string }) {
  let results
  try {
    results = await searchWikidataEntity(artistName)
  } catch (err) {
    console.error('Wikidata検索に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">Wikidataでの検索に失敗しました。</p>
  }

  if (results.length === 0) {
    return <p className="mt-8 text-sm text-white/40">該当する候補が見つかりませんでした。</p>
  }

  return (
    <div className="mt-8 space-y-2">
      {results.map((r) => (
        <Link
          key={r.qid}
          href={`/admin/data/artists/${artistId}/geo-search?qid=${r.qid}`}
          prefetch={false}
          className="block rounded-md border border-white/15 px-4 py-3 text-sm hover:bg-white/5"
        >
          <span className="font-medium">{r.label}</span>
          {r.description && <span className="ml-2 text-xs text-white/40">{r.description}</span>}
        </Link>
      ))}
    </div>
  )
}

async function CoordinatesPreview({ artistId, qid }: { artistId: string; qid: string }) {
  let coords
  try {
    coords = await fetchOriginCoordinates(qid)
  } catch (err) {
    console.error('Wikidata座標取得に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">Wikidataからの取得に失敗しました。</p>
  }

  if (!coords) {
    return <p className="mt-8 text-sm text-white/40">この候補には座標データがありませんでした。</p>
  }

  return (
    <div className="mt-8">
      <Link
        href={`/admin/data/artists/${artistId}/geo-search`}
        prefetch={false}
        className="text-xs text-white/40 hover:text-white/70"
      >
        ← 候補一覧に戻る
      </Link>

      <p className="mt-4 text-sm text-white/70">
        {coords.placeLabel}({coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)})
      </p>

      <form action={importOriginCoordinates} className="mt-6">
        <input type="hidden" name="artist_id" value={artistId} />
        <input type="hidden" name="latitude" value={coords.latitude} />
        <input type="hidden" name="longitude" value={coords.longitude} />
        <SubmitButton />
      </form>
    </div>
  )
}
```

- [ ] **Step 4: `app/admin/data/artists/[id]/edit/page.tsx`にナビゲーションリンクを追加する**

現在の35〜49行目:

```tsx
        <div className="flex gap-3">
          <Link
            href={`/admin/data/artists/${artist.id}/musicbrainz`}
            prefetch={false}
            className="text-xs text-white/40 hover:text-white/70"
          >
            MusicBrainzで検索
          </Link>
          <Link
            href={`/admin/data/artists/${artist.id}/collaborators`}
            className="text-xs text-white/40 hover:text-white/70"
          >
            コラボアーティストを探す
          </Link>
        </div>
```

を次のように変更する:

```tsx
        <div className="flex gap-3">
          <Link
            href={`/admin/data/artists/${artist.id}/musicbrainz`}
            prefetch={false}
            className="text-xs text-white/40 hover:text-white/70"
          >
            MusicBrainzで検索
          </Link>
          <Link
            href={`/admin/data/artists/${artist.id}/collaborators`}
            className="text-xs text-white/40 hover:text-white/70"
          >
            コラボアーティストを探す
          </Link>
          <Link
            href={`/admin/data/artists/${artist.id}/geo-search`}
            prefetch={false}
            className="text-xs text-white/40 hover:text-white/70"
          >
            Wikidataで座標を検索
          </Link>
        </div>
```

- [ ] **Step 5: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 6: 開発サーバーで実機確認**

1. Wikidata未リンクの実アーティスト(例: 名誉伝説、`artist_external_link`に`link_type='wikidata'`の行が無いことを事前にSupabase MCPで確認してから選ぶ)の編集ページから「Wikidataで座標を検索」をクリックし、候補一覧が表示されることを確認
2. 候補を選んでプレビューに遷移し、地名・座標が表示されることを確認
3. 「この座標を保存する」を実行し、成功メッセージが表示されることを確認
4. Supabase MCPで対象アーティストの`origin_latitude`/`origin_longitude`が正しく保存されていることを確認(実データへの反映で問題ない)

- [ ] **Step 7: コミット**

```bash
git add app/admin/data/artists/\[id\]/geo-search app/admin/data/artists/\[id\]/edit/page.tsx
git commit -m "feat: add per-artist Wikidata coordinate search and import"
```

---

### Task 4: 会場の座標登録(Nominatim)

**Files:**
- Create: `app/admin/data/venues/page.tsx`
- Create: `app/admin/data/venues/actions.ts`
- Create: `app/admin/data/venues/SubmitButton.tsx`
- Modify: `app/admin/data/page.tsx`(Task 2で変更済みのナビゲーション行にリンクを追加)

**Interfaces:**
- Consumes: `geocodeVenue`, `NominatimResult`(Task 1、`@/utils/nominatim`)。

- [ ] **Step 1: `app/admin/data/venues/SubmitButton.tsx`を作成する**

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

- [ ] **Step 2: `app/admin/data/venues/actions.ts`を作成する**

```ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'

export async function importVenueLocation(formData: FormData) {
  const venueName = String(formData.get('venue_name') ?? '')
  const latitude = Number(formData.get('latitude') ?? '')
  const longitude = Number(formData.get('longitude') ?? '')

  if (!venueName || Number.isNaN(latitude) || Number.isNaN(longitude)) {
    redirect('/admin/data/venues')
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('venue_location')
    .upsert(
      { venue_name: venueName, latitude, longitude, source: 'nominatim' },
      { onConflict: 'venue_name', ignoreDuplicates: true }
    )

  if (error) {
    redirect(`/admin/data/venues?error=${encodeURIComponent(`保存に失敗しました: ${error.message}`)}`)
  }

  revalidatePath('/admin/data/venues')
  redirect(`/admin/data/venues?success=${encodeURIComponent(`「${venueName}」の座標を保存しました。`)}`)
}
```

- [ ] **Step 3: `app/admin/data/venues/page.tsx`を作成する**

```tsx
import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { geocodeVenue } from '@/utils/nominatim'
import { importVenueLocation } from './actions'
import SubmitButton from './SubmitButton'

export default async function VenuesPage({
  searchParams,
}: {
  searchParams: Promise<{ venue?: string; success?: string; error?: string }>
}) {
  const { venue, success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  const [{ data: musicEvents }, { data: eventEditions }, { data: eventAppearances }, { data: existingLocations }] =
    await Promise.all([
      supabase.from('music_event').select('venue'),
      supabase.from('event_edition').select('venue'),
      supabase.from('event_appearance').select('venue'),
      supabase.from('venue_location').select('venue_name'),
    ])

  const knownNames = new Set((existingLocations ?? []).map((v) => v.venue_name))
  const allVenueNames = new Set<string>()
  for (const rows of [musicEvents, eventEditions, eventAppearances]) {
    for (const row of rows ?? []) {
      if (row.venue) allVenueNames.add(row.venue)
    }
  }
  const unresolvedVenues = Array.from(allVenueNames)
    .filter((name) => !knownNames.has(name))
    .sort()

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">会場の座標登録</h1>

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      {venue ? (
        <VenueCandidates venueName={venue} />
      ) : unresolvedVenues.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">未登録の会場はありません。</p>
      ) : (
        <ul className="mt-8 space-y-1.5 text-sm">
          {unresolvedVenues.map((name) => (
            <li key={name} className="flex items-center justify-between gap-2">
              <span>{name}</span>
              <Link
                href={`/admin/data/venues?venue=${encodeURIComponent(name)}`}
                prefetch={false}
                className="text-xs text-white/40 hover:text-white/70"
              >
                座標を検索 →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

async function VenueCandidates({ venueName }: { venueName: string }) {
  let results
  try {
    results = await geocodeVenue(venueName)
  } catch (err) {
    console.error('Nominatim検索に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">検索に失敗しました。</p>
  }

  if (results.length === 0) {
    return <p className="mt-8 text-sm text-white/40">該当する候補が見つかりませんでした。</p>
  }

  return (
    <div className="mt-8">
      <Link href="/admin/data/venues" prefetch={false} className="text-xs text-white/40 hover:text-white/70">
        ← 会場一覧に戻る
      </Link>

      <div className="mt-4 space-y-2">
        {results.map((r, i) => (
          <form
            key={i}
            action={importVenueLocation}
            className="flex items-center justify-between gap-3 rounded-md border border-white/15 px-4 py-3 text-sm"
          >
            <input type="hidden" name="venue_name" value={venueName} />
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

- [ ] **Step 4: `app/admin/data/page.tsx`にナビゲーションリンクを追加する**

Task 2が既に次の形に変更済み(188〜198行目相当):

```tsx
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">手動データ登録</h1>
        <div className="flex gap-3">
          <Link href="/admin/data/artists/geo" className="text-xs text-white/40 hover:text-white/70">
            アーティスト座標を一括更新
          </Link>
          <Link href="/admin/import" className="text-xs text-white/40 hover:text-white/70">
            iTunes一括登録へ →
          </Link>
        </div>
      </div>
```

これを次のように変更する(`<div className="flex gap-3">`の中に会場リンクを追加):

```tsx
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">手動データ登録</h1>
        <div className="flex gap-3">
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
      </div>
```

- [ ] **Step 5: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 6: 開発サーバーで実機確認**

1. `/admin/data`から「会場の座標登録」で`/admin/data/venues`に遷移し、未登録の会場一覧が表示されることを確認(実在のイベントデータが登録されている前提。無ければ`music_event`/`event_edition`/`event_appearance`に登録済みの実データがあるか事前にSupabase MCPで確認する)
2. 1件選んで「座標を検索」をクリックし、Nominatimの候補一覧が表示されることを確認
3. 候補の1つで「この座標で登録」を実行し、成功メッセージが表示されることを確認
4. Supabase MCPで`venue_location`に正しい`venue_name`・`latitude`・`longitude`が保存されていることを確認
5. 同じ会場ページに戻り、その会場が未登録一覧から消えていることを確認

- [ ] **Step 7: コミット**

```bash
git add app/admin/data/venues app/admin/data/page.tsx
git commit -m "feat: add venue coordinate geocoding via Nominatim"
```

---

## Self-Review Notes

- **Spec coverage:** ゴール3点(Wikidata ID既知アーティストの一括自動反映、未知アーティストの検索確認フロー、会場のNominatimジオコーディング確認フロー)をTask 2〜4でそれぞれカバー。非ゴール(地図UI本体、代替収集手段、高精度名寄せ、定期実行)はいずれも実装していない。DBマイグレーションは適用済みとしてGlobal Constraintsに明記し、タスク化していない。
- **Placeholder scan:** なし。全ステップに実コードを記載。
- **Type consistency:** `WikidataSearchResult`/`WikidataOriginCoordinates`/`NominatimResult`(Task 1)のフィールド名はTask 2〜4で一貫して使用。Task 2・Task 4の`app/admin/data/page.tsx`への変更は、Task 2の変更後の状態を前提にTask 4の差分を記述しており、実行順序と整合している。
