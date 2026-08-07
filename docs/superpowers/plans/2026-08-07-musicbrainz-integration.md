# MusicBrainz連携(外部リンク・ジャンル収集) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アーティスト編集ページからMusicBrainzでそのアーティストを検索し、候補確認の上で外部リンク(公式サイト・SNS・配信/データベースサイト等)とジャンルタグを取り込み、アーティスト詳細ページに反映する。

**Architecture:** `utils/musicbrainz.ts`にAPIクライアント(検索・詳細取得)を実装し、`app/admin/data/artists/[id]/musicbrainz/`配下に検索→プレビュー→取り込みのページ+サーバーアクションを新設。取り込んだ外部リンクは新規テーブル`artist_external_link`に、ジャンルは既存の`genre`/`artist_genre`に統合する。アーティスト詳細ページ(`app/artists/[id]/page.tsx`)に外部リンク表示セクションを追加する。

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Supabase (`@supabase/ssr`のRLS対応クライアントで読み取り、`createAdminClient`のservice_roleクライアントで書き込み), Tailwind CSS v4, MusicBrainz Web Service API v2(認証不要・要User-Agent・1req/秒)。

## Global Constraints

- **DBマイグレーションは適用済み。新規タスクを作らないこと。** `artist_external_link`テーブル(`id text primary key default generate_ms_id('AEL')`, `artist_id text not null references artist(id)`, `link_type text not null`, `url text not null`, `created_at timestamptz not null default now()`)は既にSupabaseプロジェクト`ftvhglfthbcxhgnoninv`に作成済み。ユニークインデックス`artist_external_link_dedup_key`が`(artist_id, link_type, url)`に既に存在する(重複挿入防止に使う)。RLSは有効化済みで、`public`ロールに`select`のみを許可する`"Public read access"`ポリシーが既に存在する(書き込みは`service_role`のみ、既存の管理画面と同じ方針)。
- MusicBrainz APIは認証不要だが`User-Agent`ヘッダーが必須。値は`'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'`を使う。
- レート制限は1リクエスト/秒。呼び出し前に1000ms待機する(`utils/itunes.ts`の`sleep(400)`と同じパターン)。
- 許可するMusicBrainzリンク種別(`ALLOWED_LINK_TYPES`、`artist_external_link`に入れる対象)は次のちょうど10種類のみ: `streaming`, `free streaming`, `social network`, `other databases`, `allmusic`, `discogs`, `wikidata`, `IMDb`, `youtube`, `youtube music`。それ以外(`purchase for download`・`purchase for mail-order`・`lyrics`・`songkick`・`vgmdb`・`last.fm`等)は取り込まない。
- `official homepage`種別は`links`配列に入れず、`officialHomepage`という専用フィールドに分離する。`social network`種別のうち、URLのホスト名が`twitter.com`または`x.com`のものは`twitterUrl`専用フィールドへ、`instagram.com`のものは`instagramUrl`専用フィールドへ分離する(これらは`links`配列にも`artist_external_link`にも入れない)。
- `official_site_url`・`sns_x_url`・`sns_instagram_url`は、既存の値が入っている場合は上書きしない(iTunesバルク登録の再取込みで確立した「既存値は上書きしない」方針を踏襲。手動設定かiTunes取込み由来かは問わない)。
- ジャンルは`genre`テーブルに`name`のUNIQUE制約が無いため、挿入前に`name`で既存行を検索し、無い場合のみ新規作成する。
- 自動テストは追加しない(既存の検証スタイルに合わせる)。`npx tsc --noEmit`と、実データ(King Gnu, `artist.id = 'MS_ART_k5fiz18l'`, MBID `338f5d97-3133-4bf8-a58e-068ff9b5405d`)を使った実機確認で検証する。King Gnuの現在の状態: `official_site_url`は`https://music.apple.com/jp/artist/king-gnu/1258439196?uo=4`(iTunes取込み由来、既に値が入っている)、`sns_x_url`・`sns_instagram_url`は共に`null`。この状態は取り込み後の検証に使える(公式サイトは上書きされない、X/InstagramはMusicBrainzの値で埋まる、という2パターンを1回の実行で確認できる)。
- 新規UIのスタイルは既存の管理画面(`app/admin/data/artists/[id]/collaborators/`)のトーン(`text-white/40`系の細字、`rounded-md border border-white/15`のボタン/カード)に合わせる。

---

### Task 1: MusicBrainz APIクライアント

**Files:**
- Create: `utils/musicbrainz.ts`

**Interfaces:**
- Produces:
  - `searchArtist(name: string): Promise<MusicBrainzSearchResult[]>`
  - `type MusicBrainzSearchResult = { mbid: string; name: string; country: string | null; type: string | null; beginYear: number | null }`
  - `fetchArtistDetails(mbid: string): Promise<MusicBrainzArtistDetails>`
  - `type MusicBrainzArtistDetails = { officialHomepage: string | null; twitterUrl: string | null; instagramUrl: string | null; links: { type: string; url: string }[]; genres: string[] }`

- [ ] **Step 1: `utils/musicbrainz.ts`を作成する**

```ts
const MUSICBRAINZ_BASE = 'https://musicbrainz.org/ws/2'
const USER_AGENT = 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type MusicBrainzSearchResult = {
  mbid: string
  name: string
  country: string | null
  type: string | null
  beginYear: number | null
}

export async function searchArtist(name: string): Promise<MusicBrainzSearchResult[]> {
  await sleep(1000)
  const url = `${MUSICBRAINZ_BASE}/artist?query=${encodeURIComponent(name)}&fmt=json&limit=5`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) {
    throw new Error(`MusicBrainz API error (artist search): ${res.status}`)
  }
  const data = await res.json()
  return (data.artists ?? []).map((a: any) => ({
    mbid: a.id,
    name: a.name,
    country: a.country ?? null,
    type: a.type ?? null,
    beginYear: a['life-span']?.begin ? Number(String(a['life-span'].begin).slice(0, 4)) : null,
  }))
}

const ALLOWED_LINK_TYPES = new Set([
  'streaming',
  'free streaming',
  'social network',
  'other databases',
  'allmusic',
  'discogs',
  'wikidata',
  'IMDb',
  'youtube',
  'youtube music',
])

export type MusicBrainzArtistDetails = {
  officialHomepage: string | null
  twitterUrl: string | null
  instagramUrl: string | null
  links: { type: string; url: string }[]
  genres: string[]
}

export async function fetchArtistDetails(mbid: string): Promise<MusicBrainzArtistDetails> {
  await sleep(1000)
  const url = `${MUSICBRAINZ_BASE}/artist/${mbid}?inc=url-rels+genres&fmt=json`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) {
    throw new Error(`MusicBrainz API error (artist detail): ${res.status}`)
  }
  const data = await res.json()

  let officialHomepage: string | null = null
  let twitterUrl: string | null = null
  let instagramUrl: string | null = null
  const links: { type: string; url: string }[] = []

  for (const rel of data.relations ?? []) {
    const relUrl: string | undefined = rel.url?.resource
    if (!rel.type || !relUrl) continue

    if (rel.type === 'official homepage') {
      officialHomepage = relUrl
      continue
    }

    if (rel.type === 'social network') {
      let host = ''
      try {
        host = new URL(relUrl).hostname
      } catch {
        host = ''
      }
      if (host.includes('twitter.com') || host.includes('x.com')) {
        twitterUrl = relUrl
        continue
      }
      if (host.includes('instagram.com')) {
        instagramUrl = relUrl
        continue
      }
    }

    if (ALLOWED_LINK_TYPES.has(rel.type)) {
      links.push({ type: rel.type, url: relUrl })
    }
  }

  const genres = (data.genres ?? [])
    .map((g: any) => g.name)
    .filter((name: unknown): name is string => Boolean(name))

  return { officialHomepage, twitterUrl, instagramUrl, links, genres }
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: 実データでの動作確認(King Gnu, MBID `338f5d97-3133-4bf8-a58e-068ff9b5405d`)**

`/private/tmp/claude-501/-Users-th-dev-music-synapse/636c6505-a754-42fb-9059-5d744733fc56/scratchpad/verify-musicbrainz.mjs`のような使い捨てスクリプトで直接呼び出し確認する(プロジェクトルート直下に置く必要はない。ESM importの都合上、拡張子は`.mjs`にしtsx実行が不要なfetchのみの素のNode.jsスクリプトにするか、`npx tsx`で`.ts`のまま実行してよい):

```
npx tsx -e "
import('./utils/musicbrainz.ts').then(async (m) => {
  const results = await m.searchArtist('King Gnu')
  console.log(JSON.stringify(results, null, 2))
  const details = await m.fetchArtistDetails('338f5d97-3133-4bf8-a58e-068ff9b5405d')
  console.log(JSON.stringify(details, null, 2))
})
"
```

Expected: `searchArtist`の結果に`country: 'JP'`のKing Gnuが含まれる。`fetchArtistDetails`の結果で`genres`に`j-pop`・`pop rock`が含まれ、`links`配列の各要素の`type`が`ALLOWED_LINK_TYPES`のいずれかであること(`purchase for download`等が混ざっていないこと)を確認する。

- [ ] **Step 4: コミット**

```bash
git add utils/musicbrainz.ts
git commit -m "feat: add MusicBrainz API client for artist search and detail lookup"
```

---

### Task 2: 検索・プレビュー・取り込みページ(書き込み経路)

**Files:**
- Create: `app/admin/data/artists/[id]/musicbrainz/page.tsx`
- Create: `app/admin/data/artists/[id]/musicbrainz/actions.ts`
- Create: `app/admin/data/artists/[id]/musicbrainz/SubmitButton.tsx`
- Modify: `app/admin/data/artists/[id]/edit/page.tsx:32-37`(「コラボアーティストを探す」リンクの隣に「MusicBrainzで検索」リンクを追加)

**Interfaces:**
- Consumes: `searchArtist`, `fetchArtistDetails`, `MusicBrainzSearchResult`, `MusicBrainzArtistDetails`(Task 1、`@/utils/musicbrainz`)。`createAdminClient()`(`@/utils/Supabase/admin`、既存)。
- Produces: `importMusicBrainzData(formData: FormData): Promise<void>`(サーバーアクション、`artist_id`・`mbid`のhidden fieldを受け取る)。Task 3はこのタスクが作る`artist_external_link`テーブルへの書き込み内容(`link_type`・`url`列)を読み取る。

- [ ] **Step 1: `app/admin/data/artists/[id]/musicbrainz/actions.ts`を作成する**

```ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchArtistDetails } from '@/utils/musicbrainz'

function redirectWith(artistId: string, result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/artists/${artistId}/musicbrainz?${result}=${encodeURIComponent(message)}`)
}

export async function importMusicBrainzData(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')
  const mbid = String(formData.get('mbid') ?? '')

  if (!artistId || !mbid) {
    redirect('/admin/data')
  }

  let details
  try {
    details = await fetchArtistDetails(mbid)
  } catch (err) {
    console.error('MusicBrainz詳細取得に失敗しました:', err)
    redirectWith(artistId, 'error', 'MusicBrainzからの取得に失敗しました。')
  }

  const supabase = createAdminClient()

  const { data: currentArtist } = await supabase
    .from('artist')
    .select('official_site_url, sns_x_url, sns_instagram_url')
    .eq('id', artistId)
    .single()

  const fieldUpdate: Record<string, string> = {}
  if (!currentArtist?.official_site_url && details.officialHomepage) {
    fieldUpdate.official_site_url = details.officialHomepage
  }
  if (!currentArtist?.sns_x_url && details.twitterUrl) {
    fieldUpdate.sns_x_url = details.twitterUrl
  }
  if (!currentArtist?.sns_instagram_url && details.instagramUrl) {
    fieldUpdate.sns_instagram_url = details.instagramUrl
  }
  if (Object.keys(fieldUpdate).length > 0) {
    const { error } = await supabase.from('artist').update(fieldUpdate).eq('id', artistId)
    if (error) {
      redirectWith(artistId, 'error', `プロフィールの更新に失敗しました: ${error.message}`)
    }
  }

  if (details.links.length > 0) {
    const { error } = await supabase
      .from('artist_external_link')
      .upsert(
        details.links.map((link) => ({ artist_id: artistId, link_type: link.type, url: link.url })),
        { onConflict: 'artist_id,link_type,url', ignoreDuplicates: true }
      )
    if (error) {
      redirectWith(artistId, 'error', `外部リンクの保存に失敗しました: ${error.message}`)
    }
  }

  for (const genreName of details.genres) {
    const { data: existingGenre } = await supabase.from('genre').select('id').eq('name', genreName).maybeSingle()
    let genreId = existingGenre?.id as string | undefined
    if (!genreId) {
      const { data: createdGenre, error: createError } = await supabase
        .from('genre')
        .insert({ name: genreName })
        .select('id')
        .single()
      if (createError) {
        console.error(`ジャンル「${genreName}」の作成に失敗しました:`, createError)
        continue
      }
      genreId = createdGenre.id
    }
    const { error: linkError } = await supabase.from('artist_genre').upsert({ artist_id: artistId, genre_id: genreId })
    if (linkError) {
      console.error(`ジャンル「${genreName}」の紐付けに失敗しました:`, linkError)
    }
  }

  revalidatePath('/admin/data')
  revalidatePath(`/artists/${artistId}`)
  redirectWith(artistId, 'success', 'MusicBrainzのデータを取り込みました。')
}
```

- [ ] **Step 2: `app/admin/data/artists/[id]/musicbrainz/SubmitButton.tsx`を作成する**

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
      {pending ? '取り込み中...' : '取り込む'}
    </button>
  )
}
```

- [ ] **Step 3: `app/admin/data/artists/[id]/musicbrainz/page.tsx`を作成する**

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { searchArtist, fetchArtistDetails } from '@/utils/musicbrainz'
import { importMusicBrainzData } from './actions'
import SubmitButton from './SubmitButton'

const LINK_TYPE_LABEL: Record<string, string> = {
  streaming: 'ストリーミング',
  'free streaming': '無料ストリーミング',
  'social network': 'SNS',
  'other databases': 'データベース',
  allmusic: 'AllMusic',
  discogs: 'Discogs',
  wikidata: 'Wikidata',
  IMDb: 'IMDb',
  youtube: 'YouTube',
  'youtube music': 'YouTube Music',
}

export default async function MusicBrainzPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ mbid?: string; success?: string; error?: string }>
}) {
  const { id } = await params
  const { mbid, success, error: errorMessage } = await searchParams
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

      <h1 className="mt-4 text-2xl font-bold">{artist.name} をMusicBrainzで検索</h1>

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      {mbid ? (
        <MusicBrainzPreview artistId={id} mbid={mbid} />
      ) : (
        <MusicBrainzSearchResults artistId={id} artistName={artist.name} />
      )}
    </div>
  )
}

async function MusicBrainzSearchResults({ artistId, artistName }: { artistId: string; artistName: string }) {
  let results
  try {
    results = await searchArtist(artistName)
  } catch (err) {
    console.error('MusicBrainz検索に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">MusicBrainzでの検索に失敗しました。</p>
  }

  if (results.length === 0) {
    return <p className="mt-8 text-sm text-white/40">該当するアーティストが見つかりませんでした。</p>
  }

  return (
    <div className="mt-8 space-y-2">
      {results.map((r) => (
        <Link
          key={r.mbid}
          href={`/admin/data/artists/${artistId}/musicbrainz?mbid=${r.mbid}`}
          className="block rounded-md border border-white/15 px-4 py-3 text-sm hover:bg-white/5"
        >
          <span className="font-medium">{r.name}</span>
          <span className="ml-2 text-xs text-white/40">
            {r.type ?? '種別不明'} / {r.country ?? '国不明'} / {r.beginYear ? `${r.beginYear}年〜` : '結成年不明'}
          </span>
        </Link>
      ))}
    </div>
  )
}

async function MusicBrainzPreview({ artistId, mbid }: { artistId: string; mbid: string }) {
  let details
  try {
    details = await fetchArtistDetails(mbid)
  } catch (err) {
    console.error('MusicBrainz詳細取得に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">MusicBrainzからの取得に失敗しました。</p>
  }

  return (
    <div className="mt-8">
      <Link
        href={`/admin/data/artists/${artistId}/musicbrainz`}
        className="text-xs text-white/40 hover:text-white/70"
      >
        ← 候補一覧に戻る
      </Link>

      <div className="mt-4 space-y-4 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-white/40">公式サイト・SNS</p>
          <p className="mt-1 text-white/70">
            公式サイト: {details.officialHomepage ?? 'なし'} / X: {details.twitterUrl ?? 'なし'} / Instagram:{' '}
            {details.instagramUrl ?? 'なし'}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-white/40">外部リンク({details.links.length}件)</p>
          {details.links.length === 0 ? (
            <p className="mt-1 text-white/40">なし</p>
          ) : (
            <ul className="mt-1 space-y-1 text-white/70">
              {details.links.map((link, i) => (
                <li key={i}>
                  {LINK_TYPE_LABEL[link.type] ?? link.type}: {link.url}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-white/40">ジャンル</p>
          <p className="mt-1 text-white/70">{details.genres.length > 0 ? details.genres.join('、') : 'なし'}</p>
        </div>
      </div>

      <form action={importMusicBrainzData} className="mt-6">
        <input type="hidden" name="artist_id" value={artistId} />
        <input type="hidden" name="mbid" value={mbid} />
        <SubmitButton />
      </form>
    </div>
  )
}
```

- [ ] **Step 4: `app/admin/data/artists/[id]/edit/page.tsx`にリンクを追加する**

`app/admin/data/artists/[id]/edit/page.tsx:32-37`の`<Link href={\`/admin/data/artists/${artist.id}/collaborators\`}>...</Link>`を次のように、隣にMusicBrainzへのリンクを追加した形に変更する:

```tsx
        <div className="flex gap-3">
          <Link
            href={`/admin/data/artists/${artist.id}/musicbrainz`}
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

(この`<div>`は既存の`<div className="flex items-center justify-between">`内、「← 管理画面に戻る」の`<Link>`の次に配置される兄弟要素として、元の単独`<Link>`を置き換える。)

- [ ] **Step 5: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 6: 開発サーバーでPlaywright実機確認(King Gnu, `artist.id = 'MS_ART_k5fiz18l'`)**

1. `/admin/data/artists/MS_ART_k5fiz18l/edit`を開き、「MusicBrainzで検索」リンクが表示されることを確認
2. クリックして`/admin/data/artists/MS_ART_k5fiz18l/musicbrainz`に遷移し、候補一覧に国:JPのKing Gnuが表示されることを確認
3. 候補をクリックしてプレビューに遷移し、X/Instagramの有無・外部リンク一覧・ジャンル(`j-pop`・`pop rock`)が表示されることを確認
4. 「取り込む」を押し、成功メッセージが表示されることを確認
5. Supabase MCPの`execute_sql`で以下を確認:
   - `select official_site_url, sns_x_url, sns_instagram_url from artist where id = 'MS_ART_k5fiz18l'` → `official_site_url`は取り込み前と同じ`https://music.apple.com/...`のまま(上書きされていない)、`sns_x_url`・`sns_instagram_url`はMusicBrainzの値で埋まっている
   - `select link_type, url from artist_external_link where artist_id = 'MS_ART_k5fiz18l'` → `ALLOWED_LINK_TYPES`に含まれる種別のみが入っている
   - `select g.name from artist_genre ag join genre g on g.id = ag.genre_id where ag.artist_id = 'MS_ART_k5fiz18l'` → `j-pop`・`pop rock`が含まれる
6. 同じ候補で再度「取り込む」を実行し、`artist_external_link`・`artist_genre`が重複しないことを確認(既存データはそのまま、実データなのでテスト後の削除は不要)

- [ ] **Step 7: コミット**

```bash
git add app/admin/data/artists/\[id\]/musicbrainz app/admin/data/artists/\[id\]/edit/page.tsx
git commit -m "feat: add MusicBrainz search/preview/import flow for artist external links and genres"
```

---

### Task 3: アーティスト詳細ページへの外部リンク表示(読み取り経路)

**Files:**
- Modify: `app/artists/[id]/page.tsx`

**Interfaces:**
- Consumes: `artist_external_link`テーブル(Task 2が書き込む、列`id`・`link_type`・`url`)。

- [ ] **Step 1: 外部リンクを取得するクエリを追加する**

`app/artists/[id]/page.tsx:25-46`の`Promise.all`に`artist_external_link`の取得を追加する。現在のブロック:

```tsx
  const [{ data: artist, error }, { data: albums }, { data: relations }, { data: musicEvents }, { data: eventAppearances }] =
    await Promise.all([
      supabase.from('artist').select('*').eq('id', id).single(),
      supabase
        .from('album')
        .select('id, title, jacket_url, release_date, album_type')
        .eq('artist_id', id)
        .order('release_date', { ascending: false, nullsFirst: false }),
      supabase
        .from('artist_relation')
        .select('artist_id_a, artist_id_b, relation_type, relation_style, description')
        .or(`artist_id_a.eq.${id},artist_id_b.eq.${id}`),
      supabase
        .from('music_event')
        .select('id, name, event_date, venue')
        .eq('artist_id', id)
        .order('event_date', { ascending: false, nullsFirst: false }),
      supabase
        .from('event_appearance')
        .select('id, stage, venue, is_headliner, event_edition:event_edition_id(year, venue, event:event_id(name))')
        .eq('artist_id', id),
    ])
```

これを次のように変更する(`{ data: externalLinks }`を追加):

```tsx
  const [
    { data: artist, error },
    { data: albums },
    { data: relations },
    { data: musicEvents },
    { data: eventAppearances },
    { data: externalLinks },
  ] = await Promise.all([
    supabase.from('artist').select('*').eq('id', id).single(),
    supabase
      .from('album')
      .select('id, title, jacket_url, release_date, album_type')
      .eq('artist_id', id)
      .order('release_date', { ascending: false, nullsFirst: false }),
    supabase
      .from('artist_relation')
      .select('artist_id_a, artist_id_b, relation_type, relation_style, description')
      .or(`artist_id_a.eq.${id},artist_id_b.eq.${id}`),
    supabase
      .from('music_event')
      .select('id, name, event_date, venue')
      .eq('artist_id', id)
      .order('event_date', { ascending: false, nullsFirst: false }),
    supabase
      .from('event_appearance')
      .select('id, stage, venue, is_headliner, event_edition:event_edition_id(year, venue, event:event_id(name))')
      .eq('artist_id', id),
    supabase.from('artist_external_link').select('id, link_type, url').eq('artist_id', id),
  ])
```

- [ ] **Step 2: リンク種別のラベルマップを追加する**

`app/artists/[id]/page.tsx:1-5`のimport群の直後、`SectionDivider`関数の前に追加する:

```tsx
const LINK_TYPE_LABEL: Record<string, string> = {
  streaming: 'ストリーミング',
  'free streaming': '無料ストリーミング',
  'social network': 'SNS',
  'other databases': 'データベース',
  allmusic: 'AllMusic',
  discogs: 'Discogs',
  wikidata: 'Wikidata',
  IMDb: 'IMDb',
  youtube: 'YouTube',
  'youtube music': 'YouTube Music',
}
```

- [ ] **Step 3: External Linksセクションを追加する**

`app/artists/[id]/page.tsx`の現在197〜200行目付近、ヘッダーブロックを閉じる`</div>`(198行目)の直後・`{artist.bio && (`ブロック(200行目)の直前に、次のセクションを挿入する:

```tsx
      {externalLinks && externalLinks.length > 0 && (
        <>
          <SectionDivider label="External Links" />
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {externalLinks.map((link) => (
              <a
                key={link.id}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-white/15 px-3 py-1.5 hover:bg-white/5"
              >
                {LINK_TYPE_LABEL[link.link_type] ?? link.link_type}
              </a>
            ))}
          </div>
        </>
      )}

```

(挿入位置: ヘッダーの`</div>`の閉じタグの次の行から、`{artist.bio && (`の行の前まで。既存の`{artist.bio && (...)}`ブロックはそのまま残す。)

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 5: 開発サーバーでPlaywright実機確認**

Task 2のStep 6で`MS_ART_k5fiz18l`(King Gnu)に外部リンクを取り込み済みであることを前提に、`/artists/MS_ART_k5fiz18l`を開き:

1. `External Links`セクションが表示されること
2. リンクのラベルが`LINK_TYPE_LABEL`の日本語(または`AllMusic`等の固有名詞そのまま)で表示されていること
3. 各リンクをクリックすると新しいタブで正しいURLが開くこと
4. 外部リンクが1件も無いアーティスト(例: MusicBrainz未実行の他アーティスト)のページでは`External Links`セクション自体が表示されないこと

- [ ] **Step 6: コミット**

```bash
git add app/artists/\[id\]/page.tsx
git commit -m "feat: display MusicBrainz external links on artist detail page"
```

---

## Self-Review Notes

- **Spec coverage:** ゴール3点(検索→確認→取り込みUI、詳細ページ表示、genre/artist_genre統合)を各タスクでカバー。非ゴール(全件一括・ニッチリンク種別・tags取り込み・既存値上書き)は`ALLOWED_LINK_TYPES`・`genres`のみ使用・上書きしない分岐で反映済み。DBマイグレーションは適用済みとしてGlobal Constraintsに明記し、タスク化していない。
- **Placeholder scan:** なし。全ステップに実コードを記載。
- **Type consistency:** `MusicBrainzArtistDetails`(Task 1)のフィールド名(`officialHomepage`/`twitterUrl`/`instagramUrl`/`links`/`genres`)はTask 2の`actions.ts`・`page.tsx`で一貫して使用。`artist_external_link`の列名(`link_type`/`url`)はTask 2の書き込みとTask 3の読み取りで一致。
