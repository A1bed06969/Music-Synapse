# アーティストのクレジット情報(プロデューサー・スタッフ等)収集 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アルバム単位でMusicBrainzのリリースを検索・確認し、制作クレジット(プロデューサー等)を取得して、既存アーティストなら`artist_relation`に、未登録の人物なら新設の`credit_person`/`artist_credit`に反映し、相関図・専用ページで閲覧できるようにする。

**Architecture:** `utils/musicbrainz.ts`にリリース検索・クレジット取得のクライアントを追加し、`app/admin/data/albums/[id]/credits/`配下に検索→プレビュー→取り込みのページ+サーバーアクションを新設する。クレジット対象人物ごとに`artist.musicbrainz_id`と照合し、既存アーティストと一致すれば`artist_relation`へ、それ以外は新設の`credit_person`/`artist_credit`テーブルへ書き込む。相関図(`RelationGraph`)を人物ノードに対応させ、専用の`/people/[id]`ページを新設する。

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Supabase (`@supabase/ssr`のRLS対応クライアントで読み取り、`createAdminClient`のservice_roleクライアントで書き込み), Tailwind CSS v4, MusicBrainz Web Service API v2(認証不要・要User-Agent・1req/秒)。Discogs連携は本プランの対象外(後続の別プランで実装)。

## Global Constraints

- **DBマイグレーションは実装開始前にコントローラーが直接Supabase MCPで適用する(サブエージェントに委譲しない、既存の方針を踏襲)。** 以下のSQLを、Task 1着手前に適用しておくこと(このプラン自体の実行時点でまだ未適用の場合、実行者はこのSQLが適用済みである前提でコードを書いてよい — 適用作業自体はコントローラーの責務):

```sql
create table credit_person (
  id text primary key default generate_ms_id('CRP'),
  name text not null,
  musicbrainz_id text,
  discogs_id text,
  created_at timestamptz not null default now()
);
create unique index credit_person_musicbrainz_id_key on credit_person (musicbrainz_id) where musicbrainz_id is not null;
create unique index credit_person_discogs_id_key on credit_person (discogs_id) where discogs_id is not null;
alter table credit_person enable row level security;
create policy "Public read access" on credit_person for select to public using (true);

create table artist_credit (
  id text primary key default generate_ms_id('ACR'),
  artist_id text not null references artist(id),
  album_id text references album(id),
  credit_person_id text not null references credit_person(id),
  role text not null,
  source text not null,
  source_url text,
  created_at timestamptz not null default now()
);
create unique index artist_credit_dedup_key on artist_credit (artist_id, album_id, credit_person_id, role, source);
create index idx_artist_credit_artist on artist_credit (artist_id);
create index idx_artist_credit_person on artist_credit (credit_person_id);
alter table artist_credit enable row level security;
create policy "Public read access" on artist_credit for select to public using (true);

alter table artist add column musicbrainz_id text;
create unique index artist_musicbrainz_id_key on artist (musicbrainz_id) where musicbrainz_id is not null;

-- 適用前に既存データに重複が無いことを確認してから実行すること:
-- select artist_id_a, artist_id_b, relation_type, count(*) from artist_relation group by 1,2,3 having count(*) > 1;
create unique index artist_relation_dedup_key on artist_relation (artist_id_a, artist_id_b, relation_type);
```

- クレジットの役割(role)は次の7種類のみを対象とする: `producer` / `mix` / `mastering` / `composer` / `lyricist` / `arranger` / `artwork`。MusicBrainzの実際の関係種別文字列は`producer`/`mix`/`mastering`/`composer`/`lyricist`/`arranger`/`artwork`/`design/illustration`(最後の2つは両方`artwork`にマッピングする)。これら以外の種別(engineer/photography/liner notes等)は取り込み対象外。
- 制作クレジットはMusicBrainzの**リリース単位**のデータであり、`GET /release/{id}?inc=artist-rels`で取得する(`GET /artist/{mbid}?inc=artist-rels`ではない。これはアーティスト同士の直接的な関係、例: member of band、のみを返す)。
- クレジット対象人物が既存アーティストかどうかは、常にMusicBrainz ID(MBID)による完全一致でのみ判定する(名前でのあいまい照合は行わない)。一致すれば`artist_relation`(`relation_type='production'`, `relation_style='solid'`)へ、一致しなければ`credit_person`を検索/作成した上で`artist_credit`へ書き込む。
- `artist_relation`への書き込みはアルバム単位の粒度を持たせず、アーティストペア単位のまま(既存テーブルの意味を変えない)。`artist_credit`は`album_id`を含めて記録する(同じ人物が複数アルバムで同じ役割を持つ場合、アルバムごとに別の実績として記録される)。
- MusicBrainz APIへのリクエストは既存の`fetchMusicBrainz`ヘルパー(1req/秒のsleep + 503リトライ)を必ず経由すること。新しい関数から直接`fetch`を呼ばない。
- 自動テストは追加しない。検証は`npx tsc --noEmit`と実機確認(King Gnuの実アルバム、既存アーティストとして登録済みのYaffleを含む)で行う。
- King Gnuの実データでの検証例: MBID `338f5d97-3133-4bf8-a58e-068ff9b5405d`、アルバム「Tokyo Rendez-Vous」のMusicBrainzリリースMBID(検証時点)`a1903173-deb7-428d-9793-a9e7f1a62dc2`(2017-10-25, Japan)。

---

### Task 1: MusicBrainzリリース検索・クレジット取得クライアント + MBID保存

**Files:**
- Modify: `utils/musicbrainz.ts`
- Modify: `app/admin/data/artists/[id]/musicbrainz/actions.ts:12-34`(`importMusicBrainzData`が取り込み時に`artist.musicbrainz_id`も保存するようにする)

**Interfaces:**
- Produces:
  - `export type MusicBrainzReleaseSearchResult = { mbid: string; title: string; date: string | null; country: string | null; score: number | null }`
  - `export async function searchRelease(title: string, artistName: string): Promise<MusicBrainzReleaseSearchResult[]>`
  - `export type MusicBrainzReleaseCredit = { personName: string; personMbid: string; role: string; sourceUrl: string }`
  - `export async function fetchReleaseCredits(releaseMbid: string): Promise<MusicBrainzReleaseCredit[]>`
  - `export const CREDIT_ROLE_LABEL: Record<string, string>`(role → 日本語ラベル、Task 2・Task 3で再利用する)

- [ ] **Step 1: `utils/musicbrainz.ts`に`searchRelease`を追加する**

`utils/musicbrainz.ts`の`searchArtist`関数の直後に追加する:

```ts
export type MusicBrainzReleaseSearchResult = {
  mbid: string
  title: string
  date: string | null
  country: string | null
  score: number | null
}

export async function searchRelease(title: string, artistName: string): Promise<MusicBrainzReleaseSearchResult[]> {
  const query = `release:"${title}" AND artist:"${artistName}"`
  const url = `${MUSICBRAINZ_BASE}/release?query=${encodeURIComponent(query)}&fmt=json&limit=5`
  const data = await fetchMusicBrainz(url, 'release search')
  return (data.releases ?? []).map((r: any) => {
    const event = (r['release-events'] ?? [])[0]
    return {
      mbid: r.id,
      title: r.title,
      date: event?.date ?? r.date ?? null,
      country: event?.area?.name ?? null,
      score: r.score != null && !Number.isNaN(Number(r.score)) ? Number(r.score) : null,
    }
  })
}
```

- [ ] **Step 2: `utils/musicbrainz.ts`に`fetchReleaseCredits`と`CREDIT_ROLE_LABEL`を追加する**

ファイル末尾に追加する:

```ts
const CREDIT_ROLE_TYPE_MAP: Record<string, string> = {
  producer: 'producer',
  mix: 'mix',
  mastering: 'mastering',
  composer: 'composer',
  lyricist: 'lyricist',
  arranger: 'arranger',
  artwork: 'artwork',
  'design/illustration': 'artwork',
}

export const CREDIT_ROLE_LABEL: Record<string, string> = {
  producer: 'プロデューサー',
  mix: 'ミックス',
  mastering: 'マスタリング',
  composer: '作曲',
  lyricist: '作詞',
  arranger: '編曲',
  artwork: 'アートワーク',
}

export type MusicBrainzReleaseCredit = {
  personName: string
  personMbid: string
  role: string
  sourceUrl: string
}

export async function fetchReleaseCredits(releaseMbid: string): Promise<MusicBrainzReleaseCredit[]> {
  const url = `${MUSICBRAINZ_BASE}/release/${releaseMbid}?inc=artist-rels&fmt=json`
  const data = await fetchMusicBrainz(url, 'release credits')
  const sourceUrl = `https://musicbrainz.org/release/${releaseMbid}`
  const credits: MusicBrainzReleaseCredit[] = []
  for (const rel of data.relations ?? []) {
    const role = CREDIT_ROLE_TYPE_MAP[rel.type]
    if (!role || !rel.artist?.id || !rel.artist?.name) continue
    credits.push({
      personName: rel.artist.name,
      personMbid: rel.artist.id,
      role,
      sourceUrl,
    })
  }
  return credits
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: 実データでの動作確認**

`/private/tmp/claude-501/-Users-th-dev-music-synapse/636c6505-a754-42fb-9059-5d744733fc56/scratchpad/verify-release-credits.mjs`のような使い捨てスクリプトで確認する:

```
npx tsx -e "
import('./utils/musicbrainz.ts').then(async (m) => {
  const releases = await m.searchRelease('Tokyo Rendez-Vous', 'King Gnu')
  console.log(JSON.stringify(releases, null, 2))
  const credits = await m.fetchReleaseCredits(releases[0].mbid)
  console.log(JSON.stringify(credits, null, 2))
})
"
```

Expected: `searchRelease`の結果に国:Japan、2017年前後のリリースが含まれる。`fetchReleaseCredits`の結果が`CREDIT_ROLE_LABEL`のキーに含まれる`role`のみを持つ配列であること(engineer等は含まれない)。

- [ ] **Step 5: `app/admin/data/artists/[id]/musicbrainz/actions.ts`を変更し、`artist.musicbrainz_id`を保存する**

現在12〜34行目の`importMusicBrainzData`冒頭〜`currentArtist`取得部分:

```ts
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
```

これを次のように変更する(`musicbrainz_id`を`select`に追加し、`fieldUpdate`に条件付きで追加):

```ts
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
    .select('official_site_url, sns_x_url, sns_instagram_url, musicbrainz_id')
    .eq('id', artistId)
    .single()

  const fieldUpdate: Record<string, string> = {}
  if (!currentArtist?.musicbrainz_id) {
    fieldUpdate.musicbrainz_id = mbid
  }
  if (!currentArtist?.official_site_url && details.officialHomepage) {
    fieldUpdate.official_site_url = details.officialHomepage
  }
```

(以降のコードは変更しない。`profileFieldCount`の計算・成功メッセージは既存のまま`Object.keys(fieldUpdate).length`を使っているので、自動的に`musicbrainz_id`の更新も件数に含まれる。)

- [ ] **Step 6: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 7: 実機確認**

開発サーバーで King Gnu(`artist.id = 'MS_ART_k5fiz18l'`、既にMusicBrainz取り込み済みなので`musicbrainz_id`は未設定のはず)の編集ページから「MusicBrainzで検索」→King Gnuを選択して再取り込みを実行し、Supabaseで`select musicbrainz_id from artist where id = 'MS_ART_k5fiz18l'`を確認して`338f5d97-3133-4bf8-a58e-068ff9b5405d`が保存されていることを確認する。

- [ ] **Step 8: コミット**

```bash
git add utils/musicbrainz.ts app/admin/data/artists/\[id\]/musicbrainz/actions.ts
git commit -m "feat: add MusicBrainz release search/credit fetch and persist artist MBID"
```

---

### Task 2: アルバムのクレジット取り込みUI(管理画面)

**Files:**
- Create: `app/admin/data/albums/[id]/credits/page.tsx`
- Create: `app/admin/data/albums/[id]/credits/actions.ts`
- Create: `app/admin/data/albums/[id]/credits/SubmitButton.tsx`
- Modify: `app/admin/data/artists/[id]/edit/page.tsx`(このアーティストのアルバム一覧+各アルバムへの「クレジットを取り込む」リンクを追加)

**Interfaces:**
- Consumes: `searchRelease`, `fetchReleaseCredits`, `CREDIT_ROLE_LABEL`, `type MusicBrainzReleaseCredit`(Task 1、`@/utils/musicbrainz`)。`createAdminClient()`(`@/utils/Supabase/admin`、既存)。
- Produces: `importAlbumCredits(formData: FormData): Promise<void>`(サーバーアクション、`album_id`・`artist_id`・`release_mbid`のhidden fieldを受け取る)。Task 3はこのタスクが書き込む`artist_credit`テーブル(`artist_id`・`album_id`・`credit_person_id`・`role`列)と`credit_person`テーブル(`id`・`name`列)を読み取る。

- [ ] **Step 1: `app/admin/data/albums/[id]/credits/actions.ts`を作成する**

```ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchReleaseCredits } from '@/utils/musicbrainz'

function redirectWith(albumId: string, result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/albums/${albumId}/credits?${result}=${encodeURIComponent(message)}`)
}

export async function importAlbumCredits(formData: FormData) {
  const albumId = String(formData.get('album_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '')
  const releaseMbid = String(formData.get('release_mbid') ?? '')

  if (!albumId || !artistId || !releaseMbid) {
    redirect('/admin/data')
  }

  let credits
  try {
    credits = await fetchReleaseCredits(releaseMbid)
  } catch (err) {
    console.error('MusicBrainzのクレジット取得に失敗しました:', err)
    redirectWith(albumId, 'error', 'MusicBrainzからの取得に失敗しました。')
  }

  const supabase = createAdminClient()

  let relationCount = 0
  let creditCount = 0

  for (const credit of credits) {
    const { data: matchedArtist } = await supabase
      .from('artist')
      .select('id')
      .eq('musicbrainz_id', credit.personMbid)
      .maybeSingle()

    if (matchedArtist) {
      if (matchedArtist.id === artistId) {
        continue
      }
      const { error } = await supabase
        .from('artist_relation')
        .upsert(
          {
            artist_id_a: matchedArtist.id,
            artist_id_b: artistId,
            relation_type: 'production',
            relation_style: 'solid',
          },
          { onConflict: 'artist_id_a,artist_id_b,relation_type', ignoreDuplicates: true }
        )
      if (error) {
        console.error(`関係の保存に失敗しました(${credit.personName}):`, error)
        continue
      }
      relationCount += 1
      continue
    }

    const { data: existingPerson } = await supabase
      .from('credit_person')
      .select('id')
      .eq('musicbrainz_id', credit.personMbid)
      .maybeSingle()

    let personId = existingPerson?.id as string | undefined
    if (!personId) {
      const { data: createdPerson, error: createError } = await supabase
        .from('credit_person')
        .insert({ name: credit.personName, musicbrainz_id: credit.personMbid })
        .select('id')
        .single()
      if (createError) {
        console.error(`人物「${credit.personName}」の作成に失敗しました:`, createError)
        continue
      }
      personId = createdPerson.id
    }

    const { error: creditError } = await supabase
      .from('artist_credit')
      .upsert(
        {
          artist_id: artistId,
          album_id: albumId,
          credit_person_id: personId,
          role: credit.role,
          source: 'musicbrainz',
          source_url: credit.sourceUrl,
        },
        { onConflict: 'artist_id,album_id,credit_person_id,role,source', ignoreDuplicates: true }
      )
    if (creditError) {
      console.error(`クレジット「${credit.personName}」の保存に失敗しました:`, creditError)
      continue
    }
    creditCount += 1
  }

  revalidatePath('/admin/data')
  revalidatePath(`/artists/${artistId}`)

  redirectWith(albumId, 'success', `アーティスト関係${relationCount}件・クレジット${creditCount}件を取り込みました`)
}
```

- [ ] **Step 2: `app/admin/data/albums/[id]/credits/SubmitButton.tsx`を作成する**

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

- [ ] **Step 3: `app/admin/data/albums/[id]/credits/page.tsx`を作成する**

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { searchRelease, fetchReleaseCredits, CREDIT_ROLE_LABEL, type MusicBrainzReleaseCredit } from '@/utils/musicbrainz'
import { importAlbumCredits } from './actions'
import SubmitButton from './SubmitButton'

export default async function AlbumCreditsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ mbid?: string; success?: string; error?: string }>
}) {
  const { id } = await params
  const { mbid, success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  const { data: album, error } = await supabase
    .from('album')
    .select('id, title, artist_id, artist:artist_id(id, name)')
    .eq('id', id)
    .single()

  if (error || !album) {
    notFound()
  }

  const artist = Array.isArray(album.artist) ? album.artist[0] : album.artist
  if (!artist) {
    notFound()
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link
        href={`/admin/data/artists/${artist.id}/edit`}
        prefetch={false}
        className="text-xs text-white/40 hover:text-white/70"
      >
        ← {artist.name} の編集に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{album.title} のクレジットを取り込む</h1>

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      {mbid ? (
        <CreditsPreview albumId={album.id} artistId={artist.id} mbid={mbid} />
      ) : (
        <ReleaseSearchResults albumId={album.id} albumTitle={album.title} artistName={artist.name} />
      )}
    </div>
  )
}

async function ReleaseSearchResults({
  albumId,
  albumTitle,
  artistName,
}: {
  albumId: string
  albumTitle: string
  artistName: string
}) {
  let results
  try {
    results = await searchRelease(albumTitle, artistName)
  } catch (err) {
    console.error('MusicBrainzのリリース検索に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">MusicBrainzでの検索に失敗しました。</p>
  }

  if (results.length === 0) {
    return <p className="mt-8 text-sm text-white/40">該当するリリースが見つかりませんでした。</p>
  }

  return (
    <div className="mt-8 space-y-2">
      {results.map((r) => (
        <Link
          key={r.mbid}
          href={`/admin/data/albums/${albumId}/credits?mbid=${r.mbid}`}
          prefetch={false}
          className="block rounded-md border border-white/15 px-4 py-3 text-sm hover:bg-white/5"
        >
          <span className="font-medium">{r.title}</span>
          <span className="ml-2 text-xs text-white/40">
            {r.date ?? '発売日不明'} / {r.country ?? '国不明'} / 一致度: {r.score ?? '?'}%
          </span>
        </Link>
      ))}
    </div>
  )
}

async function CreditsPreview({ albumId, artistId, mbid }: { albumId: string; artistId: string; mbid: string }) {
  let credits: MusicBrainzReleaseCredit[]
  try {
    credits = await fetchReleaseCredits(mbid)
  } catch (err) {
    console.error('MusicBrainzのクレジット取得に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">MusicBrainzからの取得に失敗しました。</p>
  }

  if (credits.length === 0) {
    return <p className="mt-8 text-sm text-white/40">主要な役割のクレジットが見つかりませんでした。</p>
  }

  const supabase = await createClient()
  const mbids = credits.map((c) => c.personMbid)
  const { data: matchedArtists } = await supabase.from('artist').select('id, name, musicbrainz_id').in('musicbrainz_id', mbids)
  const matchByMbid = new Map((matchedArtists ?? []).map((a) => [a.musicbrainz_id as string, a]))

  return (
    <div className="mt-8">
      <Link
        href={`/admin/data/albums/${albumId}/credits`}
        prefetch={false}
        className="text-xs text-white/40 hover:text-white/70"
      >
        ← 候補一覧に戻る
      </Link>

      <ul className="mt-4 space-y-2 text-sm">
        {credits.map((c, i) => {
          const matched = matchByMbid.get(c.personMbid)
          return (
            <li key={i} className="rounded-md border border-white/15 px-4 py-3">
              <span className="font-medium">{c.personName}</span>
              <span className="ml-2 text-xs text-white/40">{CREDIT_ROLE_LABEL[c.role] ?? c.role}</span>
              {matched && matched.id !== artistId && (
                <p className="mt-1 text-xs text-white/40">→ 既存アーティスト「{matched.name}」として登録されます</p>
              )}
              {matched && matched.id === artistId && (
                <p className="mt-1 text-xs text-white/40">→ このアーティスト自身のためスキップされます</p>
              )}
              {!matched && <p className="mt-1 text-xs text-white/40">→ 新規人物として登録されます</p>}
            </li>
          )
        })}
      </ul>

      <form action={importAlbumCredits} className="mt-6">
        <input type="hidden" name="album_id" value={albumId} />
        <input type="hidden" name="artist_id" value={artistId} />
        <input type="hidden" name="release_mbid" value={mbid} />
        <SubmitButton />
      </form>
    </div>
  )
}
```

- [ ] **Step 4: `app/admin/data/artists/[id]/edit/page.tsx`にアルバム一覧を追加する**

現在17〜24行目のアーティスト取得部分:

```tsx
  const { id } = await params
  const supabase = await createClient()

  const { data: artist, error } = await supabase.from('artist').select('*').eq('id', id).single()

  if (error || !artist) {
    notFound()
  }
```

これを次のように変更する(アルバム一覧の取得を追加):

```tsx
  const { id } = await params
  const supabase = await createClient()

  const { data: artist, error } = await supabase.from('artist').select('*').eq('id', id).single()

  if (error || !artist) {
    notFound()
  }

  const { data: albums } = await supabase
    .from('album')
    .select('id, title')
    .eq('artist_id', id)
    .order('release_date', { ascending: false, nullsFirst: false })
```

現在139〜142行目の末尾(保存ボタンの直後、`</form>`の後):

```tsx
        <button type="submit" className={buttonClass}>
          保存
        </button>
      </form>
    </div>
  )
}
```

これを次のように変更する(アルバム一覧セクションを追加):

```tsx
        <button type="submit" className={buttonClass}>
          保存
        </button>
      </form>

      {albums && albums.length > 0 && (
        <div className="mt-8">
          <p className="text-xs uppercase tracking-wide text-white/40">アルバムのクレジットを取り込む</p>
          <ul className="mt-3 space-y-1.5">
            {albums.map((album) => (
              <li key={album.id} className="flex items-center justify-between text-sm">
                <span>{album.title}</span>
                <Link
                  href={`/admin/data/albums/${album.id}/credits`}
                  prefetch={false}
                  className="text-xs text-white/40 hover:text-white/70"
                >
                  クレジットを取り込む →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 6: 開発サーバーでPlaywright実機確認(King Gnu, `artist.id = 'MS_ART_k5fiz18l'`)**

1. `/admin/data/artists/MS_ART_k5fiz18l/edit`を開き、アルバム一覧に「クレジットを取り込む」リンクが並んでいることを確認
2. 「Tokyo Rendez-Vous」のクレジット取り込みリンクをクリックし、`/admin/data/albums/{album-id}/credits`でMusicBrainzのリリース候補一覧(国:Japan、2017年前後)が表示されることを確認
3. 候補を選んでプレビューに遷移し、producer等のクレジットが表示されることを確認
4. 「取り込む」を押し、成功メッセージ(件数入り)が表示されることを確認
5. Supabase MCPの`execute_sql`で以下を確認:
   - `select role, credit_person_id, album_id from artist_credit where artist_id = 'MS_ART_k5fiz18l'` → 主要7役割のみが入っている
   - `select name, musicbrainz_id from credit_person where id in (select credit_person_id from artist_credit where artist_id = 'MS_ART_k5fiz18l')` → 人物名とMBIDが正しく保存されている
6. 同じリリースで再度「取り込む」を実行し、`artist_credit`・`credit_person`が重複しないことを確認(既存データはそのまま、実データなのでテスト後の削除は不要)
7. もしYaffleがこのアルバムのクレジットに含まれていれば(MBID一致)、`credit_person`にYaffleが新規作成されず、`artist_relation`にYaffle↔King Gnuの`production`関係が追加されていることを確認。含まれていなければ、Yaffleが実際にクレジットされている別のアーティスト・アルバムで同様の確認を行う

- [ ] **Step 7: コミット**

```bash
git add app/admin/data/albums app/admin/data/artists/\[id\]/edit/page.tsx
git commit -m "feat: add album-level MusicBrainz credit import flow"
```

---

### Task 3: 相関図の人物ノード対応 + 人物ページ + アーティストページへの統合

**Files:**
- Modify: `app/components/RelationGraph.tsx`
- Create: `app/people/[id]/page.tsx`
- Modify: `app/artists/[id]/page.tsx`

**Interfaces:**
- Consumes: `CREDIT_ROLE_LABEL`(Task 1、`@/utils/musicbrainz`)。`artist_credit`テーブル(Task 2が書き込む、列`artist_id`・`album_id`・`credit_person_id`・`role`)、`credit_person`テーブル(列`id`・`name`)。
- Produces: `RelationNode`に`type?: 'artist' | 'person'`を追加(既存の`type`未指定の呼び出し元は`'artist'`扱いのまま動作する)。

- [ ] **Step 1: `app/components/RelationGraph.tsx`の型と描画を変更する**

現在20行目の型定義:

```ts
export type RelationNode = { id: string; name: string; category?: string | null }
```

これを次のように変更する:

```ts
export type RelationNode = { id: string; name: string; category?: string | null; type?: 'artist' | 'person' }
```

現在189〜191行目(クリック時のナビゲーション):

```ts
      if (!current.moved) {
        router.push(`/artists/${current.node.id}`)
      }
```

これを次のように変更する:

```ts
      if (!current.moved) {
        router.push(current.node.type === 'person' ? `/people/${current.node.id}` : `/artists/${current.node.id}`)
      }
```

現在256〜283行目のノード描画部分:

```tsx
        <g>
          {simNodes.map((node) => {
            if (node.x == null || node.y == null) return null
            const isCenter = node.id === centerId
            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                onPointerDown={(e) => handlePointerDown(e, node)}
                className={isCenter ? 'cursor-default' : 'cursor-pointer'}
              >
                <circle
                  r={isCenter ? 26 : 18}
                  fill={isCenter ? '#fff' : 'rgba(255,255,255,0.14)'}
                  stroke="rgba(255,255,255,0.4)"
                  strokeWidth={1}
                />
                <text
                  y={isCenter ? 42 : 32}
                  textAnchor="middle"
                  fill={isCenter ? '#fff' : 'rgba(255,255,255,0.7)'}
                  fontSize={isCenter ? 13 : 11}
                  fontWeight={isCenter ? 700 : 400}
                >
                  {node.name}
                </text>
              </g>
            )
          })}
        </g>
```

これを次のように変更する(人物ノードは角丸四角+破線で区別する):

```tsx
        <g>
          {simNodes.map((node) => {
            if (node.x == null || node.y == null) return null
            const isCenter = node.id === centerId
            const isPerson = node.type === 'person'
            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                onPointerDown={(e) => handlePointerDown(e, node)}
                className={isCenter ? 'cursor-default' : 'cursor-pointer'}
              >
                {isPerson ? (
                  <rect
                    x={-16}
                    y={-16}
                    width={32}
                    height={32}
                    rx={6}
                    fill="rgba(255,255,255,0.14)"
                    stroke="rgba(255,255,255,0.4)"
                    strokeWidth={1}
                    strokeDasharray="3 2"
                  />
                ) : (
                  <circle
                    r={isCenter ? 26 : 18}
                    fill={isCenter ? '#fff' : 'rgba(255,255,255,0.14)'}
                    stroke="rgba(255,255,255,0.4)"
                    strokeWidth={1}
                  />
                )}
                <text
                  y={isPerson ? 30 : isCenter ? 42 : 32}
                  textAnchor="middle"
                  fill={isCenter ? '#fff' : 'rgba(255,255,255,0.7)'}
                  fontSize={isCenter ? 13 : 11}
                  fontWeight={isCenter ? 700 : 400}
                >
                  {node.name}
                </text>
              </g>
            )
          })}
        </g>
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: `app/people/[id]/page.tsx`を作成する**

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { CREDIT_ROLE_LABEL } from '@/utils/musicbrainz'

export default async function CreditPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: person, error } = await supabase.from('credit_person').select('id, name').eq('id', id).single()

  if (error || !person) {
    notFound()
  }

  const { data: credits } = await supabase
    .from('artist_credit')
    .select('id, role, artist:artist_id(id, name), album:album_id(id, title)')
    .eq('credit_person_id', id)
    .order('role')

  const creditsByRole = new Map<
    string,
    { id: string; artistId: string; artistName: string; albumTitle: string | null }[]
  >()
  for (const row of credits ?? []) {
    const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
    const album = Array.isArray(row.album) ? row.album[0] : row.album
    if (!artist) continue
    const list = creditsByRole.get(row.role) ?? []
    list.push({ id: row.id, artistId: artist.id, artistName: artist.name, albumTitle: album?.title ?? null })
    creditsByRole.set(row.role, list)
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/search" className="text-xs text-white/40 hover:text-white/70">
        ← 検索に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{person.name}</h1>

      {creditsByRole.size === 0 ? (
        <p className="mt-8 text-sm text-white/40">まだクレジット情報がありません。</p>
      ) : (
        Array.from(creditsByRole.entries()).map(([role, items]) => (
          <div key={role} className="mt-8">
            <p className="text-xs uppercase tracking-wide text-white/40">{CREDIT_ROLE_LABEL[role] ?? role}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {items.map((item) => (
                <li key={item.id}>
                  <Link href={`/artists/${item.artistId}`} className="hover:text-white/70">
                    {item.artistName}
                  </Link>
                  {item.albumTitle && <span className="ml-2 text-xs text-white/40">{item.albumTitle}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  )
}
```

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 5: `app/artists/[id]/page.tsx`に`artist_credit`の取得とグラフへのマージを追加する**

現在26〜59行目の`Promise.all`ブロック末尾(`artist_external_link`取得の直後):

```tsx
    supabase
      .from('artist_external_link')
      .select('id, link_type, url')
      .eq('artist_id', id)
      .order('link_type', { ascending: true })
      .order('url', { ascending: true }),
  ])
```

これを次のように変更する(`artist_credit`の取得を追加。分割代入の変数リストにも`{ data: artistCredits }`を追加すること):

```tsx
    supabase
      .from('artist_external_link')
      .select('id, link_type, url')
      .eq('artist_id', id)
      .order('link_type', { ascending: true })
      .order('url', { ascending: true }),
    supabase
      .from('artist_credit')
      .select('role, credit_person:credit_person_id(id, name)')
      .eq('artist_id', id),
  ])
```

(この変更に伴い、25〜32行目の分割代入リストの末尾`{ data: externalLinks },`の次に`{ data: artistCredits },`を追加する。)

現在103〜118行目の`relationNodes`/`relationEdges`計算部分:

```tsx
  const relationNodes: RelationNode[] = otherIds.length
    ? [{ id: artist.id, name: artist.name }, ...(others ?? [])].map((a) => ({
        id: a.id,
        name: a.name,
        category: categoryByArtist.get(a.id) ?? null,
      }))
    : []
  const relationNodeIds = new Set(relationNodes.map((n) => n.id))
  const relationEdges: RelationEdge[] = (relations ?? [])
    .filter((r) => relationNodeIds.has(r.artist_id_a) && relationNodeIds.has(r.artist_id_b))
    .map((r) => ({
      source: r.artist_id_a,
      target: r.artist_id_b,
      style: (r.relation_style as 'solid' | 'dotted') ?? 'solid',
      label: r.description ?? r.relation_type,
    }))
```

これを次のように変更する(クレジット人物のノード・エッジをマージする):

```tsx
  const creditsByPerson = new Map<string, { name: string; roles: Set<string> }>()
  for (const row of artistCredits ?? []) {
    const person = Array.isArray(row.credit_person) ? row.credit_person[0] : row.credit_person
    if (!person) continue
    const entry = creditsByPerson.get(person.id) ?? { name: person.name, roles: new Set<string>() }
    entry.roles.add(row.role)
    creditsByPerson.set(person.id, entry)
  }

  const hasGraphData = otherIds.length > 0 || creditsByPerson.size > 0

  const relationNodes: RelationNode[] = hasGraphData
    ? [
        ...[{ id: artist.id, name: artist.name }, ...(others ?? [])].map((a) => ({
          id: a.id,
          name: a.name,
          category: categoryByArtist.get(a.id) ?? null,
          type: 'artist' as const,
        })),
        ...Array.from(creditsByPerson.entries()).map(([personId, p]) => ({
          id: personId,
          name: p.name,
          type: 'person' as const,
        })),
      ]
    : []
  const relationNodeIds = new Set(relationNodes.map((n) => n.id))
  const relationEdges: RelationEdge[] = [
    ...(relations ?? [])
      .filter((r) => relationNodeIds.has(r.artist_id_a) && relationNodeIds.has(r.artist_id_b))
      .map((r) => ({
        source: r.artist_id_a,
        target: r.artist_id_b,
        style: (r.relation_style as 'solid' | 'dotted') ?? 'solid',
        label: r.description ?? r.relation_type,
      })),
    ...Array.from(creditsByPerson.entries()).map(([personId, p]) => ({
      source: personId,
      target: artist.id,
      style: 'solid' as const,
      label: Array.from(p.roles)
        .map((role) => CREDIT_ROLE_LABEL[role] ?? role)
        .join('・'),
    })),
  ]
```

- [ ] **Step 6: `app/artists/[id]/page.tsx`のimportに`CREDIT_ROLE_LABEL`を追加する**

現在5行目:

```tsx
import RelationGraph, { type RelationEdge, type RelationNode } from '@/app/components/RelationGraph'
```

の直後に追加する:

```tsx
import { CREDIT_ROLE_LABEL } from '@/utils/musicbrainz'
```

- [ ] **Step 7: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 8: 開発サーバーで実機確認**

Task 2のStep 6でKing Gnuの「Tokyo Rendez-Vous」のクレジットを取り込み済みであることを前提に:

1. `/artists/MS_ART_k5fiz18l`を開き、相関図に角丸四角(破線枠)の人物ノードが表示されることを確認
2. 人物ノードをドラッグせずクリックし、`/people/{person-id}`に遷移することを確認
3. `/people/{person-id}`で、役割ごとにグループ化されたクレジット一覧(King Gnu・アルバム名)が表示され、King Gnuへのリンクが機能することを確認
4. もしYaffleがKing Gnuの実際のクレジットに含まれていれば(Task 2のStep 6で確認済みの場合)、Yaffle自身の`/artists/{yaffle-id}`ページの相関図にもKing Gnuとの`production`関係(通常の円ノード、四角ノードではない)が表示されることを確認する

- [ ] **Step 9: コミット**

```bash
git add app/components/RelationGraph.tsx app/people app/artists/\[id\]/page.tsx
git commit -m "feat: display credit persons in relation graph and add person detail page"
```

---

## Self-Review Notes

- **Spec coverage:** ゴール5点(アルバム単位取り込み・MusicBrainz検索確認・既存アーティストへのartist_relation反映・新規人物へのcredit_person/artist_credit反映・相関図+人物ページ表示)をTask 1〜3でカバー。非ゴール(自動巡回・演奏楽器別クレジット・名寄せ・credit_person編集UI・アルバム汎用管理画面・Discogs)はいずれも本プランで手を加えていない。
- **Placeholder scan:** なし。全ステップに実コードを記載。
- **Type consistency:** `MusicBrainzReleaseCredit`(Task 1)のフィールド名(`personName`/`personMbid`/`role`/`sourceUrl`)はTask 2の`actions.ts`・`page.tsx`で一貫して使用。`RelationNode.type`(Task 3)は`'artist' | 'person'`のリテラル型でTask 3内一貫。`CREDIT_ROLE_LABEL`のキー(`producer`/`mix`/`mastering`/`composer`/`lyricist`/`arranger`/`artwork`)はTask 1で定義した`CREDIT_ROLE_TYPE_MAP`の出力値と一致し、Task 2・Task 3の表示ロジックで一貫して使用。
