# 複数アーティストアルバム対応 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存の未使用テーブル`album_artist`を使って、1つのアルバムに複数アーティストを紐付けられるようにし、紐付いた全アーティストのディスコグラフィー・アルバムページに反映させる。

**Architecture:** `album.artist_id`(NOT NULL、代表アーティスト)は変更せず、追加アーティストだけを`album_artist(album_id, artist_id, role, billing_order)`に保持する。管理画面に汎用の紐付けページを1つ新設し、そこから公開ページ(アルバムページのアーティスト名表示、アーティストページのディスコグラフィー)を拡張する。

**Tech Stack:** Next.js App Router (Server Actions), Supabase (Postgres, PostgREST)、TypeScript。新規外部依存なし。

**Spec:** `docs/superpowers/specs/2026-08-21-multi-artist-album-design.md`

## Global Constraints

- `album.artist_id`は一切変更しない(既存の全クエリへの影響を避けるため)。代表アーティストとして今まで通り機能する
- `album_artist.role`は`'main'`(対等なコラボ)と`'featured'`(フィーチャリング)の2値だけを使う。DBのCHECK制約は`'split'`も許容するが、今回のUI・アクションからは使わない
- `billing_order`は代表アーティスト(album.artist_id側)が暗黙に位置1を占めるものとし、追加アーティストは「そのアルバムの既存album_artist行数 + 2」から採番する
- トラック単位(`track.artist_id`)・OCR抽出スキーマ(`utils/geminiDiscGuideExtract.ts`)は一切変更しない
- 追加アーティストの紐付けは全て管理画面からの手動操作(自動判定・自動分割ロジックは作らない)

---

### Task 1: `album_artist`テーブルへのUNIQUE制約追加

**Files:**
- Create: `supabase/migrations/20260821_album_artist_unique.sql`

**Interfaces:**
- Produces: `album_artist(album_id, artist_id)`のUNIQUE制約。以降のタスクの`linkAlbumArtist`アクションが、重複紐付け時にこの制約違反(Postgres SQLSTATE `23505`)を検知してユーザー向けエラーメッセージに変換する

- [ ] **Step 1: マイグレーションファイルを作成**

`supabase/migrations/20260821_album_artist_unique.sql`:

```sql
-- 同じアーティストを同じアルバムに重複して紐付けるのを防ぐ。
-- album_artistテーブル自体・role/billing_order列・RLS・CHECK制約は
-- 既に存在しているため、このマイグレーションではUNIQUE制約のみ追加する。
ALTER TABLE album_artist ADD CONSTRAINT album_artist_album_id_artist_id_key
  UNIQUE (album_id, artist_id);
```

- [ ] **Step 2: Supabase MCPの`apply_migration`で適用**

`name`は`album_artist_unique`、`query`は上記SQL全体。適用後、`execute_sql`で
`select conname from pg_constraint where conrelid = 'album_artist'::regclass and conname = 'album_artist_album_id_artist_id_key';`
を実行し、1行返ってくることを確認する。

- [ ] **Step 3: コミット**

```bash
git add supabase/migrations/20260821_album_artist_unique.sql
git commit -m "feat: add unique constraint to album_artist table"
```

---

### Task 2: 紐付け・解除の管理アクション

**Files:**
- Create: `app/admin/data/albums/actions.ts`

**Interfaces:**
- Consumes: なし
- Produces: `export async function linkAlbumArtist(formData: FormData): Promise<void>`、`export async function unlinkAlbumArtist(formData: FormData): Promise<void>`(Task 3の管理画面ページが呼ぶ)

- [ ] **Step 1: `app/admin/data/albums/actions.ts`を作成**

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'

function redirectWith(albumId: string, result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/albums/${albumId}/co-artists?${result}=${encodeURIComponent(message)}`)
}

/** アルバムに追加アーティストを紐付ける。既に代表アーティスト(album.artist_id)と
 * 同じ場合や、既に紐付け済み(UNIQUE制約違反)の場合はエラーメッセージを返す。
 * billing_orderは代表アーティストが暗黙に位置1を占めるものとして、
 * 既存のalbum_artist行数+2から採番する。 */
export async function linkAlbumArtist(formData: FormData) {
  const albumId = String(formData.get('album_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')
  const role = String(formData.get('role') ?? '')

  if (!albumId || !artistId || (role !== 'featured' && role !== 'main')) {
    redirect('/admin/data')
  }

  const supabase = createAdminClient()

  const { data: album } = await supabase.from('album').select('artist_id').eq('id', albumId).single()
  if (!album) {
    redirectWith(albumId, 'error', 'アルバムが見つかりませんでした。')
  }
  if (album!.artist_id === artistId) {
    redirectWith(albumId, 'error', 'そのアーティストは既に代表アーティストとして登録されています。')
  }

  const { count } = await supabase
    .from('album_artist')
    .select('id', { count: 'exact', head: true })
    .eq('album_id', albumId)

  const { error } = await supabase.from('album_artist').insert({
    album_id: albumId,
    artist_id: artistId,
    role,
    billing_order: (count ?? 0) + 2,
  })

  if (error) {
    if (error.code === '23505') {
      redirectWith(albumId, 'error', 'そのアーティストは既に紐付け済みです。')
    }
    redirectWith(albumId, 'error', `紐付けに失敗しました: ${error.message}`)
  }

  revalidatePath(`/admin/data/albums/${albumId}/co-artists`)
  revalidatePath(`/albums/${albumId}`)
  revalidatePath(`/artists/${artistId}`)
  redirectWith(albumId, 'success', '追加アーティストを紐付けました。')
}

export async function unlinkAlbumArtist(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const albumId = String(formData.get('album_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')

  if (!id || !albumId) {
    redirect('/admin/data')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('album_artist').delete().eq('id', id)

  if (error) {
    redirectWith(albumId, 'error', `削除に失敗しました: ${error.message}`)
  }

  revalidatePath(`/admin/data/albums/${albumId}/co-artists`)
  revalidatePath(`/albums/${albumId}`)
  if (artistId) revalidatePath(`/artists/${artistId}`)
  redirectWith(albumId, 'success', '紐付けを解除しました。')
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add app/admin/data/albums/actions.ts
git commit -m "feat: add link/unlink actions for album co-artists"
```

---

### Task 3: 追加アーティスト管理ページ

**Files:**
- Create: `app/admin/data/albums/[id]/co-artists/page.tsx`

**Interfaces:**
- Consumes: `linkAlbumArtist`/`unlinkAlbumArtist`(Task 2)、`searchArtists`(既存、`app/admin/data/actions.ts`)、`SearchableSelect`(既存、`app/admin/data/SearchableSelect.tsx`)、`inputClass`/`buttonClass`(既存、`app/admin/data/adminUi.ts`)
- Produces: なし(末端ページ)

- [ ] **Step 1: `app/admin/data/albums/[id]/co-artists/page.tsx`を作成**

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../../../adminUi'
import SearchableSelect from '../../../SearchableSelect'
import { searchArtists } from '../../../actions'
import { linkAlbumArtist, unlinkAlbumArtist } from '../../actions'

export default async function AlbumCoArtistsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { id } = await params
  const { success, error } = await searchParams
  const supabase = await createClient()

  const { data: album, error: fetchError } = await supabase
    .from('album')
    .select('id, title, artist:artist_id(id, name)')
    .eq('id', id)
    .single()

  if (fetchError || !album) {
    notFound()
  }

  const representativeArtist = Array.isArray(album.artist) ? album.artist[0] : album.artist

  const { data: coArtists } = await supabase
    .from('album_artist')
    .select('id, role, billing_order, artist:artist_id(id, name)')
    .eq('album_id', id)
    .order('billing_order', { ascending: true, nullsFirst: false })

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href={`/albums/${album.id}`} className="text-xs text-white/40 hover:text-white/70">
        ← {album.title}
      </Link>

      <h1 className="mt-4 text-2xl font-bold">追加アーティストを紐付け</h1>
      <p className="mt-2 text-sm text-white/50">{album.title}</p>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <div className="mt-6">
        <p className="text-xs text-white/40">代表アーティスト</p>
        {representativeArtist && (
          <Link href={`/artists/${representativeArtist.id}`} className="text-sm text-white/80 hover:text-white">
            {representativeArtist.name}
          </Link>
        )}
      </div>

      <div className="mt-6">
        <p className="text-xs text-white/40">追加アーティスト</p>
        {coArtists && coArtists.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm text-white/60">
            {coArtists.map((row) => {
              const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
              if (!artist) return null
              return (
                <li key={row.id} className="flex items-center justify-between gap-2">
                  <span>
                    {artist.name}
                    <span className="ml-2 text-xs text-white/30">
                      {row.role === 'featured' ? 'フィーチャリング' : '対等なコラボ'}
                    </span>
                  </span>
                  <form action={unlinkAlbumArtist}>
                    <input type="hidden" name="id" value={row.id} />
                    <input type="hidden" name="album_id" value={album.id} />
                    <input type="hidden" name="artist_id" value={artist.id} />
                    <button type="submit" className="shrink-0 text-xs text-white/40 hover:text-red-400">
                      解除
                    </button>
                  </form>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-white/30">まだ追加アーティストは登録されていません。</p>
        )}
      </div>

      <form action={linkAlbumArtist} className="mt-6 flex flex-wrap items-center gap-2">
        <input type="hidden" name="album_id" value={album.id} />
        <SearchableSelect searchAction={searchArtists} name="artist_id" placeholder="アーティストを選択" />
        <select name="role" required className={`${inputClass} max-w-[160px]`} defaultValue="">
          <option value="" disabled>
            関係性を選択
          </option>
          <option value="featured">フィーチャリング</option>
          <option value="main">対等なコラボ</option>
        </select>
        <button type="submit" className={buttonClass}>
          紐付ける
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: 型チェック・lint**

Run: `npx tsc --noEmit && npx eslint app/admin/data/albums/`
Expected: エラーなし

- [ ] **Step 3: 開発サーバーで手動確認**

Run: `npm run dev`。既存の任意のアルバムIDで`/admin/data/albums/{id}/co-artists`を開き、代表アーティスト名が表示されること、アーティストを検索して選び「対等なコラボ」で紐付けると成功メッセージと共に一覧に追加されること、「解除」で削除できることを確認する。同じアーティストをもう一度紐付けようとすると「既に紐付け済みです」エラーになることも確認する。

- [ ] **Step 4: コミット**

```bash
git add "app/admin/data/albums/[id]/co-artists/page.tsx"
git commit -m "feat: add album co-artists management page"
```

---

### Task 4: アルバムページに全アーティストを表示

**Files:**
- Modify: `app/albums/[id]/page.tsx`

**Interfaces:**
- Consumes: なし(直接Supabaseクエリ)
- Produces: なし(末端ページ)

- [ ] **Step 1: `album_artist`の取得を追加**

既存の:

```typescript
  const [{ data: tracks }, { data: discGuideSelections }] = await Promise.all([
    supabase
      .from('track')
      .select('id, disc_number, track_no, title, duration_seconds, preview_url')
      .eq('album_id', id)
      .order('disc_number', { ascending: true, nullsFirst: true })
      .order('track_no', { ascending: true }),
    supabase
      .from('disc_guide_selection')
      .select(
        'id, note, disc_guide:disc_guide_id(id, title, publisher, published_year, cover_image_url)'
      )
      .eq('album_id', id),
  ])
```

を、次で置き換える:

```typescript
  const [{ data: tracks }, { data: discGuideSelections }, { data: coArtistRows }] = await Promise.all([
    supabase
      .from('track')
      .select('id, disc_number, track_no, title, duration_seconds, preview_url')
      .eq('album_id', id)
      .order('disc_number', { ascending: true, nullsFirst: true })
      .order('track_no', { ascending: true }),
    supabase
      .from('disc_guide_selection')
      .select(
        'id, note, disc_guide:disc_guide_id(id, title, publisher, published_year, cover_image_url)'
      )
      .eq('album_id', id),
    supabase
      .from('album_artist')
      .select('artist_id, role, billing_order, artist:artist_id(id, name)')
      .eq('album_id', id)
      .order('billing_order', { ascending: true, nullsFirst: false }),
  ])
```

- [ ] **Step 2: 代表アーティスト+追加アーティストを1つのリストにまとめる**

既存の:

```typescript
  const artist = Array.isArray(album.artist) ? album.artist[0] : album.artist
  const label = Array.isArray(album.label) ? album.label[0] : album.label
```

を、次で置き換える:

```typescript
  const artist = Array.isArray(album.artist) ? album.artist[0] : album.artist
  const label = Array.isArray(album.label) ? album.label[0] : album.label

  type ArtistRef = { id: string; name: string }
  const additionalArtists: ArtistRef[] = (coArtistRows ?? [])
    .map((row) => (Array.isArray(row.artist) ? row.artist[0] : row.artist))
    .filter((a): a is ArtistRef => a !== null)
  const allArtists: ArtistRef[] = artist ? [artist, ...additionalArtists] : additionalArtists
```

- [ ] **Step 3: アーティスト名表示を複数対応にする**

既存の(タイトル下のアーティスト名リンク。ページ上部の「← アーティスト名」back-linkは変更しない):

```tsx
          <h1 className="text-2xl font-bold">{album.title}</h1>
          {artist && (
            <Link href={`/artists/${artist.id}`} className="mt-1 block text-sm text-white/60 hover:text-white">
              {artist.name}
            </Link>
          )}
```

を、次で置き換える:

```tsx
          <h1 className="text-2xl font-bold">{album.title}</h1>
          {allArtists.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-white/60">
              {allArtists.map((a, i) => (
                <span key={a.id} className="flex items-center">
                  <Link href={`/artists/${a.id}`} className="hover:text-white">
                    {a.name}
                  </Link>
                  {i < allArtists.length - 1 && <span className="text-white/40">,</span>}
                </span>
              ))}
            </p>
          )}
```

- [ ] **Step 4: 型チェック・lint**

Run: `npx tsc --noEmit && npx eslint app/albums/`
Expected: エラーなし

- [ ] **Step 5: 開発サーバーで手動確認**

Task 3で紐付けたテスト用の複数アーティストアルバムのページ(`/albums/{id}`)を開き、「代表アーティスト名, 追加アーティスト名」の形でカンマ区切り表示され、それぞれ自分のアーティストページへのリンクになっていることを確認する。追加アーティストが無いアルバム(既存の大多数)では、今まで通り単独のアーティスト名表示のままであることも確認する。

- [ ] **Step 6: コミット**

```bash
git add "app/albums/[id]/page.tsx"
git commit -m "feat: show all linked artists on album page"
```

---

### Task 5: アーティストページのディスコグラフィーに追加アーティスト分を含める

**Files:**
- Modify: `app/artists/[id]/page.tsx`

**Interfaces:**
- Consumes: なし(直接Supabaseクエリ)
- Produces: なし(末端ページ)

- [ ] **Step 1: `album_artist`経由のアルバムIDを先に取得する**

既存の:

```typescript
  // 既存の/media/newsページやイベント詳細ページと同じfetchAllNewsを再利用する
  // (next:{revalidate:1800}でキャッシュされるため、ここで叩いても実質追加の外部通信は増えない)。
  // アーティスト名に依存しないためPromise.allと並行して先行取得しておく
  const newsItemsPromise = fetchAllNews(NEWS_SOURCES)

  const [
```

を、次で置き換える:

```typescript
  // 既存の/media/newsページやイベント詳細ページと同じfetchAllNewsを再利用する
  // (next:{revalidate:1800}でキャッシュされるため、ここで叩いても実質追加の外部通信は増えない)。
  // アーティスト名に依存しないためPromise.allと並行して先行取得しておく
  const newsItemsPromise = fetchAllNews(NEWS_SOURCES)

  // ディスコグラフィーに、代表アーティスト(album.artist_id)だけでなく
  // album_artist経由で追加アーティストとして紐づいているアルバムも含めるため、
  // 先にそのアルバムID一覧を取得しておく(下のalbumQuery構築で使う)。
  const { data: coArtistLinks } = await supabase.from('album_artist').select('album_id').eq('artist_id', id)
  const coArtistAlbumIds = (coArtistLinks ?? []).map((r) => r.album_id)

  let albumQuery = supabase
    .from('album')
    .select('id, title, jacket_url, release_date, album_type, streaming_status')
  albumQuery =
    coArtistAlbumIds.length > 0
      ? albumQuery.or(`artist_id.eq.${id},id.in.(${coArtistAlbumIds.join(',')})`)
      : albumQuery.eq('artist_id', id)
  albumQuery = albumQuery.is('primary_album_id', null).order('release_date', { ascending: false, nullsFirst: false })

  const [
```

- [ ] **Step 2: 既存のインラインアルバムクエリを、Step 1で作った`albumQuery`への参照に置き換える**

既存の:

```typescript
      supabase
        .from('album')
        .select('id, title, jacket_url, release_date, album_type, streaming_status')
        .eq('artist_id', id)
        .is('primary_album_id', null)
        .order('release_date', { ascending: false, nullsFirst: false }),
```

を、次で置き換える:

```typescript
      albumQuery,
```

- [ ] **Step 3: 型チェック・lint**

Run: `npx tsc --noEmit && npx eslint app/artists/`
Expected: エラーなし

- [ ] **Step 4: 開発サーバーで手動確認**

Task 3で追加アーティストとして紐付けたテスト用アルバムについて、代表アーティストのページ(今まで通り表示される)と、追加アーティスト側のページ(`/artists/{追加アーティストid}`)の両方を開き、どちらのディスコグラフィーにもそのアルバムが表示されることを確認する。追加アーティストの紐付けが無いアーティスト(既存の大多数)では、今まで通りの一覧のままであることも確認する。

- [ ] **Step 5: コミット**

```bash
git add "app/artists/[id]/page.tsx"
git commit -m "feat: include co-artist albums in artist discography"
```

---

### Task 6: 紐付けページへの導線を追加

**Files:**
- Modify: `app/admin/data/discguides/confirm/ConfirmationClient.tsx`
- Modify: `app/admin/data/artists/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: Task 3の`/admin/data/albums/{id}/co-artists`ページ(リンク先として)
- Produces: なし(末端UI)

- [ ] **Step 1: `ConfirmationClient.tsx`に`Link`のimportと、登録済みalbum_idを保持するstateを追加**

ファイル冒頭の既存:

```typescript
'use client'

import { useState } from 'react'
import SearchableSelect from '../../SearchableSelect'
import { searchAppleMusicAlbums } from './actions'
```

を、次で置き換える:

```typescript
'use client'

import { useState } from 'react'
import Link from 'next/link'
import SearchableSelect from '../../SearchableSelect'
import { searchAppleMusicAlbums } from './actions'
```

既存の:

```typescript
  const [loading, setLoading] = useState(false)
  // サーバー側で保持しているregistered_indices(register-one/route.ts参照)から
  // 初期化する。これが無いと、1件ずつ登録した後にページを再読み込みすると
  // 「✓ 登録済み」の情報が失われ、「確認して登録」で同じ行を重複登録してしまう。
  const [registeredRows, setRegisteredRows] = useState<Record<number, boolean>>(
    Object.fromEntries((pending.registered_indices ?? []).map((i) => [i, true]))
  )
  const [registeringRow, setRegisteringRow] = useState<number | null>(null)
  const [rowError, setRowError] = useState<Record<number, string>>({})
```

を、次で置き換える:

```typescript
  const [loading, setLoading] = useState(false)
  // サーバー側で保持しているregistered_indices(register-one/route.ts参照)から
  // 初期化する。これが無いと、1件ずつ登録した後にページを再読み込みすると
  // 「✓ 登録済み」の情報が失われ、「確認して登録」で同じ行を重複登録してしまう。
  const [registeredRows, setRegisteredRows] = useState<Record<number, boolean>>(
    Object.fromEntries((pending.registered_indices ?? []).map((i) => [i, true]))
  )
  // 今回のセッションで登録したalbum_idだけを保持する(register_indicesはindexしか
  // 持たないため、ページ再読み込み後に登録済みになった行の「追加アーティストを
  // 紐付け」リンクは出せない。その場合はアーティスト編集ページの同機能を使う)。
  const [registeredAlbumIds, setRegisteredAlbumIds] = useState<Record<number, string>>({})
  const [registeringRow, setRegisteringRow] = useState<number | null>(null)
  const [rowError, setRowError] = useState<Record<number, string>>({})
```

- [ ] **Step 2: `handleRegisterOne`でレスポンスの`album_id`を保存する**

既存の:

```typescript
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRowError({ ...rowError, [i]: body.error ?? `HTTP ${res.status}` })
        return
      }
      setRegisteredRows({ ...registeredRows, [i]: true })
```

を、次で置き換える:

```typescript
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRowError({ ...rowError, [i]: body.error ?? `HTTP ${res.status}` })
        return
      }
      setRegisteredRows({ ...registeredRows, [i]: true })
      if (body.album_id) {
        setRegisteredAlbumIds({ ...registeredAlbumIds, [i]: body.album_id })
      }
```

- [ ] **Step 3: 登録済み表示の隣にリンクを追加**

既存の:

```tsx
              <div className="mt-3 flex items-center gap-3">
                {registeredRows[i] ? (
                  <span className="text-xs font-semibold text-green-400">✓ 登録済み</span>
                ) : (
```

を、次で置き換える:

```tsx
              <div className="mt-3 flex items-center gap-3">
                {registeredRows[i] ? (
                  <>
                    <span className="text-xs font-semibold text-green-400">✓ 登録済み</span>
                    {registeredAlbumIds[i] && (
                      <Link
                        href={`/admin/data/albums/${registeredAlbumIds[i]}/co-artists`}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        追加アーティストを紐付け →
                      </Link>
                    )}
                  </>
                ) : (
```

- [ ] **Step 4: `app/admin/data/artists/[id]/edit/page.tsx`にリンクを追加**

既存の:

```tsx
                  <Link
                    href={`/admin/data/albums/${album.id}/discogs-lookup`}
                    prefetch={false}
                    className="text-xs text-white/40 hover:text-white/70"
                  >
                    Discogs取込 →
                  </Link>
                </div>
```

を、次で置き換える:

```tsx
                  <Link
                    href={`/admin/data/albums/${album.id}/discogs-lookup`}
                    prefetch={false}
                    className="text-xs text-white/40 hover:text-white/70"
                  >
                    Discogs取込 →
                  </Link>
                  <Link
                    href={`/admin/data/albums/${album.id}/co-artists`}
                    prefetch={false}
                    className="text-xs text-white/40 hover:text-white/70"
                  >
                    追加アーティストを紐付け →
                  </Link>
                </div>
```

- [ ] **Step 5: 型チェック・lint**

Run: `npx tsc --noEmit && npx eslint app/admin/data/discguides/ app/admin/data/artists/`
Expected: エラーなし

- [ ] **Step 6: 開発サーバーで手動確認**

ディスクガイド確認画面(`/admin/data/discguides/confirm?pending_id=...`)で未登録の行を1件「この1件を登録」し、成功後に「追加アーティストを紐付け →」リンクが表示され、クリックするとTask 3のページに正しいalbum_idで遷移することを確認する。アーティスト編集ページ(`/admin/data/artists/{id}/edit`)でも、既存アルバムの行に同じリンクが追加されていることを確認する。

- [ ] **Step 7: コミット**

```bash
git add app/admin/data/discguides/confirm/ConfirmationClient.tsx "app/admin/data/artists/[id]/edit/page.tsx"
git commit -m "feat: add entry points to album co-artists linking"
```
