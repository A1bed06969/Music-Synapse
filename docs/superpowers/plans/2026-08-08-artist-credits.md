# アーティストのクレジット情報(プロデューサー・スタッフ等)収集 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アーティストのアルバム単位で、MusicBrainzから制作クレジット(プロデューサー・ミックス・マスタリング・作曲・作詞・編曲・アートワーク)を取得し、確認の上で取り込み、相関図と専用ページに反映する。

**Architecture:** `utils/musicbrainz.ts`にリリース検索・リリースクレジット取得を追加し、`app/admin/data/albums/[id]/credits/`配下に検索→プレビュー→取り込みのページ+サーバーアクションを新設する。クレジット対象人物が既存の`artist.musicbrainz_id`と一致すれば既存の`artist_relation`へ、一致しなければ新しい`credit_person`/`artist_credit`テーブルへ書き込む。`RelationGraph`コンポーネントを拡張して人物ノードを表示し、`app/artists/[id]/page.tsx`・`app/artists/[id]/relations/page.tsx`共通のグラフ構築ロジックを`utils/relationGraphData.ts`に抽出する。新設の`/people/[id]`ページで人物ごとのクレジット一覧を表示する。

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Supabase (`@supabase/ssr`のRLS対応クライアントで読み取り、`createAdminClient`のservice_roleクライアントで書き込み)、Tailwind CSS v4、MusicBrainz Web Service API v2。

## Global Constraints

- **DBマイグレーションは適用済み。新規タスクを作らないこと。** 以下がSupabaseプロジェクト`ftvhglfthbcxhgnoninv`に適用済み:
  - `credit_person`テーブル(`id text primary key default generate_ms_id('CRP')`, `name text not null`, `musicbrainz_id text`, `discogs_id text`, `created_at timestamptz not null default now()`)。`musicbrainz_id`・`discogs_id`それぞれにnull許容のunique index(`credit_person_musicbrainz_id_key`・`credit_person_discogs_id_key`)。
  - `artist_credit`テーブル(`id text primary key default generate_ms_id('ACR')`, `artist_id text not null references artist(id)`, `album_id text references album(id)`, `credit_person_id text not null references credit_person(id)`, `role text not null`, `source text not null`, `source_url text`, `created_at timestamptz not null default now()`)。ユニークインデックス`artist_credit_dedup_key`が`(artist_id, album_id, credit_person_id, role, source)`に存在。
  - `artist`テーブルに`musicbrainz_id text`列を追加、null許容unique index `artist_musicbrainz_id_key`。
  - `artist_relation`にユニークインデックス`artist_relation_dedup_key`を`(artist_id_a, artist_id_b, relation_type)`に追加(適用前に重複ゼロ件を確認済み)。
  - `credit_person`・`artist_credit`ともRLS有効化済み、`public`ロールに`select`のみ許可する`"Public read access"`ポリシー適用済み(書き込みはservice_roleのみ、既存の管理画面と同じ方針)。
- クレジットの役割(role)は次の7種類のみ許可する: `producer` | `mix` | `mastering` | `composer` | `lyricist` | `arranger` | `artwork`。MusicBrainzのリリース`relations`の`type`文字列と役割の対応は実データで確認済み: `producer`→producer, `mix`→mix, `mastering`→mastering, `composer`→composer, `arranger`→arranger, `design/illustration`→artwork, `lyricist`→lyricist(文字列としては標準だが実データでの出現は未確認。取れたときだけ取り込む方針)。上記以外の`type`は取り込み対象外。
- **既知の制限**: MusicBrainzの作詞(lyricist)クレジットの多くは「Work(楽曲そのものを表す抽象エンティティ)」単位で管理されており、今回のリリース単位の取得方法では拾えない場合が多い(実データで確認済み: 秋元康の実データでlyricist関係は0件)。Work単位までの追跡は今回のスコープ外。取得できるものだけ取り込む。
- MusicBrainz APIは認証不要だが`User-Agent`ヘッダーが必須。既存の`utils/musicbrainz.ts`内の`USER_AGENT`定数(`'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'`)と、503リトライ付きの`fetchMusicBrainz(url, label)`ヘルパー(1req/秒のsleep込み、3回まで503リトライ)を再利用する。新しい関数を書くたびにこのヘルパーを経由すること(直接`fetch`を呼ばない)。
- クレジット対象人物が既存アーティストと一致するかどうかは、`artist.musicbrainz_id`とMusicBrainzのクレジット対象人物MBIDの完全一致でのみ判定する(名前での照合はしない)。一致した場合は`credit_person`/`artist_credit`ではなく既存の`artist_relation`(`relation_type = 'production'`, `relation_style = 'solid'`)に書き込む。クレジット対象人物がそのアルバムの当人(セルフプロデュース等)の場合は何も書き込まない(スキップ)。
- `artist_relation`への書き込みは`.upsert(..., { onConflict: 'artist_id_a,artist_id_b,relation_type', ignoreDuplicates: true })`、`artist_credit`への書き込みは`.upsert(..., { onConflict: 'artist_id,album_id,credit_person_id,role,source', ignoreDuplicates: true })`を使うこと(重複防止インデックスと厳密に一致させる)。
- Discogs連携は非ゴール。今回はMusicBrainzのみ実装する。
- `app/relations/page.tsx`(全アーティスト横断の総合相関図)は今回のスコープ外。変更しない(`RelationNode`の新しい`type`フィールドはoptionalにし、このページが今まで通り動作し続けることを担保する)。
- 自動テストは追加しない。検証は`npx tsc --noEmit`と実機確認(King Gnu, Yaffleを含む実データ)で行う。

---

### Task 1: MusicBrainzリリースクレジット取得 + 役割ラベル + musicbrainz_id永続化

**Files:**
- Modify: `utils/musicbrainz.ts`(末尾に追加)
- Modify: `utils/format.ts`(末尾に追加)
- Modify: `app/admin/data/artists/[id]/musicbrainz/actions.ts:12-51`

**Interfaces:**
- Produces:
  - `utils/musicbrainz.ts`: `export type MusicBrainzReleaseSearchResult = { mbid: string; title: string; date: string | null; country: string | null; score: number | null }`
  - `export async function searchRelease(title: string, artistName: string): Promise<MusicBrainzReleaseSearchResult[]>`
  - `export type MusicBrainzReleaseCredit = { personName: string; personMbid: string; role: 'producer' | 'mix' | 'mastering' | 'composer' | 'lyricist' | 'arranger' | 'artwork'; sourceUrl: string }`
  - `export async function fetchReleaseCredits(releaseMbid: string): Promise<MusicBrainzReleaseCredit[]>`
  - `utils/format.ts`: `export const CREDIT_ROLE_LABEL: Record<string, string>`(キーは上記7種類の役割)
- Consumes: `utils/musicbrainz.ts`内の既存の非公開関数`fetchMusicBrainz(url: string, label: string): Promise<any>`(このファイル内から直接呼び出せる。exportされていないので他ファイルからは呼べない)

- [ ] **Step 1: `utils/musicbrainz.ts`の末尾に追記する**

現在のファイルの末尾(`fetchArtistDetails`関数の後)に、以下をそのまま追記する:

```ts

export type MusicBrainzReleaseSearchResult = {
  mbid: string
  title: string
  date: string | null
  country: string | null
  score: number | null
}

function escapeLuceneQueryValue(value: string): string {
  return value.replace(/"/g, '\\"')
}

export async function searchRelease(title: string, artistName: string): Promise<MusicBrainzReleaseSearchResult[]> {
  const query = `release:"${escapeLuceneQueryValue(title)}" AND artist:"${escapeLuceneQueryValue(artistName)}"`
  const url = `${MUSICBRAINZ_BASE}/release?query=${encodeURIComponent(query)}&fmt=json&limit=5`
  const data = await fetchMusicBrainz(url, 'release search')
  return (data.releases ?? []).map((r: any) => {
    const event = Array.isArray(r['release-events']) ? r['release-events'][0] : null
    return {
      mbid: r.id,
      title: r.title,
      date: event?.date ?? null,
      country: event?.area?.name ?? null,
      score: r.score != null && !Number.isNaN(Number(r.score)) ? Number(r.score) : null,
    }
  })
}

export type MusicBrainzReleaseCredit = {
  personName: string
  personMbid: string
  role: 'producer' | 'mix' | 'mastering' | 'composer' | 'lyricist' | 'arranger' | 'artwork'
  sourceUrl: string
}

const RELEASE_ROLE_TYPE_MAP: Record<string, MusicBrainzReleaseCredit['role']> = {
  producer: 'producer',
  mix: 'mix',
  mastering: 'mastering',
  composer: 'composer',
  lyricist: 'lyricist',
  arranger: 'arranger',
  'design/illustration': 'artwork',
}

export async function fetchReleaseCredits(releaseMbid: string): Promise<MusicBrainzReleaseCredit[]> {
  const url = `${MUSICBRAINZ_BASE}/release/${releaseMbid}?inc=artist-rels&fmt=json`
  const data = await fetchMusicBrainz(url, 'release credits')
  const sourceUrl = `https://musicbrainz.org/release/${releaseMbid}`

  const credits: MusicBrainzReleaseCredit[] = []
  for (const rel of data.relations ?? []) {
    const role = RELEASE_ROLE_TYPE_MAP[rel.type]
    if (!role) continue
    if (!rel.artist?.id || !rel.artist?.name) continue
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

- [ ] **Step 2: `utils/format.ts`の末尾に追記する**

```ts

export const CREDIT_ROLE_LABEL: Record<string, string> = {
  producer: 'プロデューサー',
  mix: 'ミックス',
  mastering: 'マスタリング',
  composer: '作曲',
  lyricist: '作詞',
  arranger: '編曲',
  artwork: 'アートワーク',
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: 実データでの動作確認(King Gnu, アルバム「Tokyo Rendez-Vous」)**

`/private/tmp/claude-501/-Users-th-dev-music-synapse/636c6505-a754-42fb-9059-5d744733fc56/scratchpad/`配下等の使い捨てスクリプトで直接呼び出し確認する:

```bash
npx tsx -e "
import('/Users/th/dev/music-synapse/utils/musicbrainz.ts').then(async (m) => {
  const results = await m.searchRelease('Tokyo Rendez-Vous', 'King Gnu')
  console.log(JSON.stringify(results, null, 2))
  if (results.length > 0) {
    const credits = await m.fetchReleaseCredits(results[0].mbid)
    console.log(JSON.stringify(credits, null, 2))
  }
})
"
```

Expected: `searchRelease`の結果にKing Gnuの「Tokyo Rendez-Vous」が含まれる(`score: 100`)。`fetchReleaseCredits`の結果の各要素の`role`が7種類のいずれかであること(演奏楽器等が混ざっていないこと)を確認する。

- [ ] **Step 5: `app/admin/data/artists/[id]/musicbrainz/actions.ts`を変更し、`artist.musicbrainz_id`を保存する**

現在の12〜51行目:

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
```

これを次のように変更する(`currentArtist`の`select`に`musicbrainz_id`を追加し、`fieldUpdate`に`musicbrainz_id`を無条件で含める。mbidはこの関数の必須パラメータなので、officialHomepage等と違いnullチェックは不要):

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
```

(この後の`links`・`genres`処理・`redirectWith`呼び出しは変更しない。ただし成功メッセージの`profileFieldCount`は`fieldUpdate`のキー数をそのまま使っているため、`musicbrainz_id`が新規保存された場合はその分も自動的にカウントに含まれる — これは意図した挙動なので追加の変更は不要。)

- [ ] **Step 6: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 7: 実機確認(King Gnuで再取込みし、musicbrainz_idが保存されることを確認)**

開発サーバーで`/admin/data/artists/MS_ART_k5fiz18l/musicbrainz`からKing Gnuの候補(MBID `338f5d97-3133-4bf8-a58e-068ff9b5405d`)を選び「取り込む」を実行する。Supabase MCPの`execute_sql`で`select musicbrainz_id from artist where id = 'MS_ART_k5fiz18l'`を実行し、`338f5d97-3133-4bf8-a58e-068ff9b5405d`が保存されていることを確認する(実データへの反映で問題ない、既存の運用と同じ)。

- [ ] **Step 8: コミット**

```bash
git add utils/musicbrainz.ts utils/format.ts app/admin/data/artists/\[id\]/musicbrainz/actions.ts
git commit -m "feat: add MusicBrainz release credit fetching and persist artist musicbrainz_id"
```

---

### Task 2: アルバム単位のクレジット取り込みUI(検索・プレビュー・振り分け・取り込み)

**Files:**
- Create: `app/admin/data/albums/[id]/credits/page.tsx`
- Create: `app/admin/data/albums/[id]/credits/actions.ts`
- Create: `app/admin/data/albums/[id]/credits/SubmitButton.tsx`
- Modify: `app/admin/data/artists/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `searchRelease`, `fetchReleaseCredits`, `MusicBrainzReleaseSearchResult`, `MusicBrainzReleaseCredit`(Task 1、`@/utils/musicbrainz`)。`CREDIT_ROLE_LABEL`(Task 1、`@/utils/format`)。`createAdminClient()`(`@/utils/Supabase/admin`、既存)。
- Produces: `importAlbumCredits(formData: FormData): Promise<void>`(サーバーアクション)。Task 3はこのタスクが書き込む`artist_relation`(`relation_type='production'`)・`credit_person`・`artist_credit`テーブルのデータを読み取る。

- [ ] **Step 1: `app/admin/data/albums/[id]/credits/SubmitButton.tsx`を作成する**

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
      {pending ? '取り込み中...' : '選択したクレジットを取り込む'}
    </button>
  )
}
```

- [ ] **Step 2: `app/admin/data/albums/[id]/credits/actions.ts`を作成する**

```ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'

function redirectWith(albumId: string, result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/albums/${albumId}/credits?${result}=${encodeURIComponent(message)}`)
}

export async function importAlbumCredits(formData: FormData) {
  const artistId = String(formData.get('artist_id') ?? '')
  const albumId = String(formData.get('album_id') ?? '')
  const creditCount = Number(formData.get('credit_count') ?? '0')

  if (!artistId || !albumId || !creditCount) {
    redirect('/admin/data')
  }

  const supabase = createAdminClient()

  let relationsWritten = 0
  let creditsWritten = 0

  for (let i = 0; i < creditCount; i++) {
    if (formData.get(`credit_${i}_include`) !== '1') continue

    const personName = String(formData.get(`credit_${i}_person_name`) ?? '')
    const personMbid = String(formData.get(`credit_${i}_person_mbid`) ?? '')
    const role = String(formData.get(`credit_${i}_role`) ?? '')
    const sourceUrl = String(formData.get(`credit_${i}_source_url`) ?? '')
    if (!personName || !personMbid || !role) continue

    const { data: matchedArtist } = await supabase
      .from('artist')
      .select('id')
      .eq('musicbrainz_id', personMbid)
      .maybeSingle()

    if (matchedArtist?.id === artistId) {
      // 自分自身がクレジットされているケース(セルフプロデュース等)は記録不要
      continue
    }

    if (matchedArtist) {
      const { error: relationError } = await supabase.from('artist_relation').upsert(
        {
          artist_id_a: matchedArtist.id,
          artist_id_b: artistId,
          relation_type: 'production',
          relation_style: 'solid',
          description: null,
        },
        { onConflict: 'artist_id_a,artist_id_b,relation_type', ignoreDuplicates: true }
      )
      if (relationError) {
        console.error(`関係の保存に失敗しました(${personName}):`, relationError)
        continue
      }
      relationsWritten += 1
      continue
    }

    const { data: existingPerson } = await supabase
      .from('credit_person')
      .select('id')
      .eq('musicbrainz_id', personMbid)
      .maybeSingle()

    let creditPersonId = existingPerson?.id as string | undefined
    if (!creditPersonId) {
      const { data: createdPerson, error: createError } = await supabase
        .from('credit_person')
        .insert({ name: personName, musicbrainz_id: personMbid })
        .select('id')
        .single()
      if (createError) {
        console.error(`人物「${personName}」の作成に失敗しました:`, createError)
        continue
      }
      creditPersonId = createdPerson.id
    }

    const { error: creditError } = await supabase.from('artist_credit').upsert(
      {
        artist_id: artistId,
        album_id: albumId,
        credit_person_id: creditPersonId,
        role,
        source: 'musicbrainz',
        source_url: sourceUrl || null,
      },
      { onConflict: 'artist_id,album_id,credit_person_id,role,source', ignoreDuplicates: true }
    )
    if (creditError) {
      console.error(`クレジット「${personName}」の保存に失敗しました:`, creditError)
      continue
    }
    creditsWritten += 1
  }

  revalidatePath(`/artists/${artistId}`)
  revalidatePath(`/artists/${artistId}/relations`)
  revalidatePath('/relations')

  redirectWith(albumId, 'success', `アーティスト関係${relationsWritten}件・クレジット${creditsWritten}件を取り込みました`)
}
```

- [ ] **Step 3: `app/admin/data/albums/[id]/credits/page.tsx`を作成する**

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { searchRelease, fetchReleaseCredits, type MusicBrainzReleaseCredit } from '@/utils/musicbrainz'
import { CREDIT_ROLE_LABEL } from '@/utils/format'
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
    .select('id, title, artist:artist_id(id, name)')
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
      <Link href={`/admin/data/artists/${artist.id}/edit`} className="text-xs text-white/40 hover:text-white/70">
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
        <CreditsPreview artistId={artist.id} albumId={album.id} releaseMbid={mbid} />
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
    console.error('MusicBrainzリリース検索に失敗しました:', err)
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

async function CreditsPreview({
  artistId,
  albumId,
  releaseMbid,
}: {
  artistId: string
  albumId: string
  releaseMbid: string
}) {
  let credits: MusicBrainzReleaseCredit[]
  try {
    credits = await fetchReleaseCredits(releaseMbid)
  } catch (err) {
    console.error('MusicBrainzクレジット取得に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">MusicBrainzからの取得に失敗しました。</p>
  }

  if (credits.length === 0) {
    return <p className="mt-8 text-sm text-white/40">対応する役割のクレジットが見つかりませんでした。</p>
  }

  const supabase = await createClient()
  const personMbids = Array.from(new Set(credits.map((c) => c.personMbid)))
  const { data: matchedArtists } = await supabase
    .from('artist')
    .select('id, name, musicbrainz_id')
    .in('musicbrainz_id', personMbids)

  const artistByMbid = new Map((matchedArtists ?? []).map((a) => [a.musicbrainz_id as string, a]))

  return (
    <div className="mt-8">
      <Link
        href={`/admin/data/albums/${albumId}/credits`}
        prefetch={false}
        className="text-xs text-white/40 hover:text-white/70"
      >
        ← リリース候補一覧に戻る
      </Link>

      <form action={importAlbumCredits} className="mt-4 space-y-3">
        <input type="hidden" name="artist_id" value={artistId} />
        <input type="hidden" name="album_id" value={albumId} />
        <input type="hidden" name="credit_count" value={credits.length} />
        {credits.map((credit, i) => {
          const matched = artistByMbid.get(credit.personMbid)
          return (
            <div key={i} className="flex items-center gap-3 text-sm">
              <input type="hidden" name={`credit_${i}_person_name`} value={credit.personName} />
              <input type="hidden" name={`credit_${i}_person_mbid`} value={credit.personMbid} />
              <input type="hidden" name={`credit_${i}_role`} value={credit.role} />
              <input type="hidden" name={`credit_${i}_source_url`} value={credit.sourceUrl} />
              <label className="flex items-center gap-2">
                <input type="checkbox" name={`credit_${i}_include`} value="1" defaultChecked />
                <span className="font-medium">{credit.personName}</span>
                <span className="text-xs text-white/40">({CREDIT_ROLE_LABEL[credit.role] ?? credit.role})</span>
                {matched && (
                  <span className="text-xs text-emerald-400">→ 既存アーティスト「{matched.name}」として登録</span>
                )}
              </label>
            </div>
          )
        })}
        <SubmitButton />
      </form>
    </div>
  )
}
```

- [ ] **Step 4: `app/admin/data/artists/[id]/edit/page.tsx`を変更し、アルバム一覧+リンクを追加する**

現在の17〜24行目:

```tsx
  const { id } = await params
  const supabase = await createClient()

  const { data: artist, error } = await supabase.from('artist').select('*').eq('id', id).single()

  if (error || !artist) {
    notFound()
  }
```

を次のように変更する(アルバム一覧を並行取得):

```tsx
  const { id } = await params
  const supabase = await createClient()

  const [{ data: artist, error }, { data: albums }] = await Promise.all([
    supabase.from('artist').select('*').eq('id', id).single(),
    supabase.from('album').select('id, title').eq('artist_id', id).order('release_date', { ascending: false }),
  ])

  if (error || !artist) {
    notFound()
  }
```

そして現在の`</form>`の直後・`</div>`(ページ最外周のdivを閉じる)の直前に、以下のセクションを追加する:

```tsx

      <div className="mt-10">
        <h2 className="text-xs uppercase tracking-wide text-white/40">アルバム別クレジット取り込み</h2>
        {!albums || albums.length === 0 ? (
          <p className="mt-3 text-sm text-white/40">まだアルバムが登録されていません。</p>
        ) : (
          <ul className="mt-3 space-y-1.5 text-sm">
            {albums.map((album) => (
              <li key={album.id} className="flex items-center justify-between gap-2">
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
        )}
      </div>
```

(挿入位置: `</form>`の閉じタグの直後、ページ最外周の`<div className="mx-auto max-w-3xl px-6 py-12">`を閉じる`</div>`の直前。)

- [ ] **Step 5: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 6: 開発サーバーで実機確認(King Gnu, アルバム「Tokyo Rendez-Vous」)**

1. `/admin/data/artists/MS_ART_k5fiz18l/edit`を開き、「アルバム別クレジット取り込み」セクションにアルバム一覧と「クレジットを取り込む」リンクが表示されることを確認
2. King Gnuの適当なアルバム(例: Tokyo Rendez-Vous)で「クレジットを取り込む」をクリックし、リリース候補一覧が表示されることを確認
3. 候補を選んでプレビューに遷移し、クレジット一覧(人物名・役割)が表示されることを確認。Yaffleが含まれるアルバムがあれば、Yaffleが「既存アーティスト『Yaffle』として登録」と表示されることを確認(Yaffleを含むアルバムが見当たらない場合、Yaffleがプロデュースに関わった別アーティストの実アルバムで確認してよい)
4. 全項目チェック済みの状態で「選択したクレジットを取り込む」を実行し、成功メッセージが表示されることを確認
5. Supabase MCPの`execute_sql`で以下を確認:
   - 既存アーティストと一致したクレジット(Yaffle等)が`artist_relation`に`relation_type='production'`で追加されていること: `select * from artist_relation where relation_type = 'production'`
   - 未登録の人物が`credit_person`に作成され、`artist_credit`に紐付いていること: `select cp.name, ac.role, ac.album_id from artist_credit ac join credit_person cp on cp.id = ac.credit_person_id where ac.artist_id = 'MS_ART_k5fiz18l'`
6. 同じアルバム・同じリリースで再度取り込みを実行し、`artist_relation`・`artist_credit`ともに重複挿入されないことを確認(既存データはそのまま、実データなのでテスト後の削除は不要)

- [ ] **Step 7: コミット**

```bash
git add app/admin/data/albums app/admin/data/artists/\[id\]/edit/page.tsx
git commit -m "feat: add album-level credit ingestion from MusicBrainz with existing-artist routing"
```

---

### Task 3: 相関図への人物ノード表示 + 共有グラフ構築ロジック + 人物ページ

**Files:**
- Create: `utils/relationGraphData.ts`
- Modify: `app/components/RelationGraph.tsx`
- Modify: `app/artists/[id]/page.tsx`
- Modify: `app/artists/[id]/relations/page.tsx`
- Create: `app/people/[id]/page.tsx`

**Interfaces:**
- Consumes: `CREDIT_ROLE_LABEL`(Task 1、`@/utils/format`)。`artist_relation`・`credit_person`・`artist_credit`テーブル(Task 2が書き込む)。
- Produces: `utils/relationGraphData.ts`: `export async function buildArtistRelationGraph(supabase: SupabaseClient, artistId: string, artistName: string): Promise<{ nodes: RelationNode[]; edges: RelationEdge[] }>`

- [ ] **Step 1: `app/components/RelationGraph.tsx`を変更する**

`RelationNode`型(20行目)を次のように変更する(`type`フィールドを追加、既存の呼び出し元との後方互換性のためoptionalにする):

```ts
export type RelationNode = { id: string; name: string; category?: string | null; type?: 'artist' | 'person' }
```

クリック時の遷移処理(現在189〜191行目)を次のように変更する:

```tsx
      if (!current.moved) {
        const path = current.node.type === 'person' ? '/people' : '/artists'
        router.push(`${path}/${current.node.id}`)
      }
```

ノードの`<circle>`描画(現在266〜271行目)を次のように変更し、`type === 'person'`のノードに破線の枠を付けて視覚的に区別する:

```tsx
                <circle
                  r={isCenter ? 26 : 18}
                  fill={isCenter ? '#fff' : 'rgba(255,255,255,0.14)'}
                  stroke="rgba(255,255,255,0.4)"
                  strokeWidth={1}
                  strokeDasharray={node.type === 'person' ? '3 3' : undefined}
                />
```

- [ ] **Step 2: `utils/relationGraphData.ts`を作成する**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RelationNode, RelationEdge } from '@/app/components/RelationGraph'
import { CREDIT_ROLE_LABEL } from '@/utils/format'

export async function buildArtistRelationGraph(
  supabase: SupabaseClient,
  artistId: string,
  artistName: string
): Promise<{ nodes: RelationNode[]; edges: RelationEdge[] }> {
  const { data: relations } = await supabase
    .from('artist_relation')
    .select('artist_id_a, artist_id_b, relation_type, relation_style, description')
    .or(`artist_id_a.eq.${artistId},artist_id_b.eq.${artistId}`)

  const otherIds = Array.from(
    new Set((relations ?? []).map((r) => (r.artist_id_a === artistId ? r.artist_id_b : r.artist_id_a)))
  )

  const [{ data: others }, { data: artistGenres }, { data: artistCredits }] = await Promise.all([
    otherIds.length
      ? supabase.from('artist').select('id, name').in('id', otherIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabase
      .from('artist_genre')
      .select('artist_id, genre:genre_id(name)')
      .in('artist_id', [artistId, ...otherIds]),
    supabase
      .from('artist_credit')
      .select('id, role, credit_person:credit_person_id(id, name)')
      .eq('artist_id', artistId),
  ])

  const categoryByArtist = new Map<string, string>()
  for (const row of artistGenres ?? []) {
    if (categoryByArtist.has(row.artist_id)) continue
    const genre = Array.isArray(row.genre) ? row.genre[0] : row.genre
    if (genre?.name) categoryByArtist.set(row.artist_id, genre.name)
  }

  const personNodes: RelationNode[] = []
  const personEdges: RelationEdge[] = []
  const seenPersonIds = new Set<string>()
  for (const credit of artistCredits ?? []) {
    const person = Array.isArray(credit.credit_person) ? credit.credit_person[0] : credit.credit_person
    if (!person) continue
    if (!seenPersonIds.has(person.id)) {
      seenPersonIds.add(person.id)
      personNodes.push({ id: person.id, name: person.name, category: null, type: 'person' })
    }
    personEdges.push({
      source: artistId,
      target: person.id,
      style: 'dotted',
      label: CREDIT_ROLE_LABEL[credit.role] ?? credit.role,
    })
  }

  const nodes: RelationNode[] =
    otherIds.length > 0 || personNodes.length > 0
      ? [
          {
            id: artistId,
            name: artistName,
            category: categoryByArtist.get(artistId) ?? null,
            type: 'artist' as const,
          },
          ...(others ?? []).map((a) => ({
            id: a.id,
            name: a.name,
            category: categoryByArtist.get(a.id) ?? null,
            type: 'artist' as const,
          })),
          ...personNodes,
        ]
      : []

  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges: RelationEdge[] = [
    ...(relations ?? [])
      .filter((r) => nodeIds.has(r.artist_id_a) && nodeIds.has(r.artist_id_b))
      .map((r) => ({
        source: r.artist_id_a,
        target: r.artist_id_b,
        style: (r.relation_style as 'solid' | 'dotted') ?? 'solid',
        label: r.description ?? r.relation_type,
      })),
    ...personEdges.filter((e) => nodeIds.has(e.target)),
  ]

  return { nodes, edges }
}
```

- [ ] **Step 3: `app/artists/[id]/page.tsx`を変更し、`buildArtistRelationGraph`を使うようにする**

まず、このファイル先頭付近の次のimport文:

```tsx
import RelationGraph, { type RelationEdge, type RelationNode } from '@/app/components/RelationGraph'
```

を次のように変更する(`RelationEdge`/`RelationNode`型はこのファイル内でこの後使わなくなるため外し、新規importを追加する):

```tsx
import RelationGraph from '@/app/components/RelationGraph'
import { buildArtistRelationGraph } from '@/utils/relationGraphData'
```

次に、`artist_relation`の取得を含む既存のトップレベル`Promise.all`(26〜59行目)から`artist_relation`の取得を削除する。現在:

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
    supabase.from('artist_external_link').select('id, link_type, url').eq('artist_id', id).order('link_type', { ascending: true }).order('url', { ascending: true }),
  ])

  if (error || !artist) {
    notFound()
  }
```

これを次のように変更する(`artist_relation`のエントリを削除し、`buildArtistRelationGraph`を別途並行実行する):

```tsx
  const [
    [{ data: artist, error }, { data: albums }, { data: musicEvents }, { data: eventAppearances }, { data: externalLinks }],
    relationGraph,
  ] = await Promise.all([
    Promise.all([
      supabase.from('artist').select('*').eq('id', id).single(),
      supabase
        .from('album')
        .select('id, title, jacket_url, release_date, album_type')
        .eq('artist_id', id)
        .order('release_date', { ascending: false, nullsFirst: false }),
      supabase
        .from('music_event')
        .select('id, name, event_date, venue')
        .eq('artist_id', id)
        .order('event_date', { ascending: false, nullsFirst: false }),
      supabase
        .from('event_appearance')
        .select('id, stage, venue, is_headliner, event_edition:event_edition_id(year, venue, event:event_id(name))')
        .eq('artist_id', id),
      supabase.from('artist_external_link').select('id, link_type, url').eq('artist_id', id).order('link_type', { ascending: true }).order('url', { ascending: true }),
    ]),
    (async () => {
      const { data: nameRow } = await supabase.from('artist').select('name').eq('id', id).single()
      return buildArtistRelationGraph(supabase, id, nameRow?.name ?? '')
    })(),
  ])

  if (error || !artist) {
    notFound()
  }
```

続いて、上のPromise.all変更の直後にある、既存の`otherIds`〜`relationEdges`の計算ロジックを丸ごと削除する。この範囲は次のブロック全体(`const otherIds = ...`から`const relationEdges: RelationEdge[] = ...`の閉じ`)`まで、`otherIds`・`others`/`artistGenres`の取得・`categoryByArtist`・`relationNodes`・`relationNodeIds`・`relationEdges`の計算を含む)で、これを検索して丸ごと削除する:

```tsx
  const otherIds = Array.from(
    new Set((relations ?? []).map((r) => (r.artist_id_a === id ? r.artist_id_b : r.artist_id_a)))
  )

  const [{ data: others }, { data: artistGenres }] = otherIds.length
    ? await Promise.all([
        supabase.from('artist').select('id, name').in('id', otherIds),
        supabase
          .from('artist_genre')
          .select('artist_id, genre:genre_id(name)')
          .in('artist_id', [id, ...otherIds]),
      ])
    : [{ data: [] }, { data: [] }]

  const categoryByArtist = new Map<string, string>()
  for (const row of artistGenres ?? []) {
    if (categoryByArtist.has(row.artist_id)) continue
    const genre = Array.isArray(row.genre) ? row.genre[0] : row.genre
    if (genre?.name) categoryByArtist.set(row.artist_id, genre.name)
  }

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

削除した箇所には何も残さない。その後、JSX内で`relationNodes`/`relationEdges`を参照している箇所(`RelationGraph`呼び出しと、その下の`relationNodes.length > 0 &&`の条件、および全画面リンク)を、それぞれ`relationGraph.nodes`/`relationGraph.edges`に置き換える。現在の該当箇所:

```tsx
      <SectionDivider label="Relation Graph" />
      <div className="mt-4 max-w-md overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
        <RelationGraph nodes={relationNodes} edges={relationEdges} centerId={artist.id} />
      </div>
      {relationNodes.length > 0 && (
        <div className="max-w-md">
          <Link
            href={`/artists/${artist.id}/relations`}
            className="mt-2 block text-right text-xs text-white/40 hover:text-white/70"
          >
            相関図を全画面で見る →
          </Link>
        </div>
      )}
```

これを次のように変更する:

```tsx
      <SectionDivider label="Relation Graph" />
      <div className="mt-4 max-w-md overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
        <RelationGraph nodes={relationGraph.nodes} edges={relationGraph.edges} centerId={artist.id} />
      </div>
      {relationGraph.nodes.length > 0 && (
        <div className="max-w-md">
          <Link
            href={`/artists/${artist.id}/relations`}
            className="mt-2 block text-right text-xs text-white/40 hover:text-white/70"
          >
            相関図を全画面で見る →
          </Link>
        </div>
      )}
```

(importの変更は本Stepの冒頭で既に行っている。ここで改めて変更する箇所はない。)

- [ ] **Step 4: `app/artists/[id]/relations/page.tsx`を変更し、同じヘルパーを使うようにする**

ファイル全体を次の内容に置き換える:

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import RelationGraph from '@/app/components/RelationGraph'
import { buildArtistRelationGraph } from '@/utils/relationGraphData'

export default async function ArtistRelationsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: artist, error } = await supabase.from('artist').select('id, name').eq('id', id).single()

  if (error || !artist) {
    notFound()
  }

  const { nodes, edges } = await buildArtistRelationGraph(supabase, artist.id, artist.name)

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link href={`/artists/${artist.id}`} className="text-xs text-white/40 hover:text-white/70">
        ← {artist.name}
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{artist.name} の相関図</h1>
      <p className="mt-2 text-sm text-white/50">
        実線は在籍/制作/コラボ、点線はジャンル・シーンや影響関係、または制作クレジットを表します。
      </p>

      <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.02]">
        <RelationGraph nodes={nodes} edges={edges} centerId={artist.id} />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: `app/people/[id]/page.tsx`を作成する**

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { CREDIT_ROLE_LABEL } from '@/utils/format'

export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
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
  for (const c of credits ?? []) {
    const artist = Array.isArray(c.artist) ? c.artist[0] : c.artist
    const album = Array.isArray(c.album) ? c.album[0] : c.album
    if (!artist) continue
    const list = creditsByRole.get(c.role) ?? []
    list.push({ id: c.id, artistId: artist.id, artistName: artist.name, albumTitle: album?.title ?? null })
    creditsByRole.set(c.role, list)
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/search" className="text-xs text-white/40 hover:text-white/70">
        ← 検索に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{person.name}</h1>

      {creditsByRole.size === 0 ? (
        <p className="mt-8 text-sm text-white/40">クレジット情報がありません。</p>
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
                  {item.albumTitle && <span className="text-white/40"> ・ {item.albumTitle}</span>}
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

- [ ] **Step 6: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 7: 開発サーバーで実機確認**

Task 2のStep 6で既にYaffleを含むクレジットをKing Gnu(または該当アーティスト)に取り込み済みであることを前提に:

1. `/artists/MS_ART_k5fiz18l`(または実際にクレジットを取り込んだアーティスト)を開き、相関図にYaffleのノードが表示されること、実線(アーティスト関係)で結ばれていることを確認
2. 未登録の人物(`credit_person`)がいるアーティストのページで、その人物のノードが破線の枠で表示され、点線のエッジで結ばれていることを確認
3. その人物ノードをクリックし、`/people/[id]`に正しく遷移することを確認
4. `/people/[id]`ページで役割ごとにグループ化されたクレジット一覧が表示され、アーティスト名のリンクが正しく`/artists/[id]`に遷移することを確認
5. `/artists/[id]/relations`(全画面版)でも同様に人物ノードが表示されることを確認
6. `/relations`(総合相関図)が今まで通りエラーなく表示されることを確認(このページは今回変更していないため、人物ノードは出ない)

- [ ] **Step 8: コミット**

```bash
git add utils/relationGraphData.ts app/components/RelationGraph.tsx app/artists/\[id\]/page.tsx app/artists/\[id\]/relations/page.tsx app/people
git commit -m "feat: show credit_person nodes in relation graph and add person detail page"
```

---

## Self-Review Notes

- **Spec coverage:** ゴール5点(アルバム単位の取り込みリンク、MusicBrainzリリース検索→クレジット取得→プレビュー、既存アーティストへの振り分け、新規人物の`credit_person`/`artist_credit`登録、相関図+人物ページへの反映)をTask 1〜3で全てカバー。非ゴール(定期実行・全リリース総当たり・演奏楽器別クレジット・高精度名寄せ・`credit_person`編集UI・Discogs・Work単位追跡・`/admin/data/albums/[id]/edit`汎用管理画面)はいずれも実装していない。DBマイグレーションは適用済みとしてGlobal Constraintsに明記し、タスク化していない。
- **Placeholder scan:** なし。全ステップに実コードを記載。
- **Type consistency:** `MusicBrainzReleaseCredit`(Task 1)の`role`ユニオン型はTask 2の`CREDIT_ROLE_LABEL`参照・Task 3の`artist_credit.role`列読み取りと一貫。`RelationNode`/`RelationEdge`(Task 3で拡張)のフィールド名はTask 3内の`utils/relationGraphData.ts`・`app/artists/[id]/page.tsx`・`app/artists/[id]/relations/page.tsx`で一致。`buildArtistRelationGraph`のシグネチャはStep 2で定義したものをStep 3・4で正しく呼び出している。
