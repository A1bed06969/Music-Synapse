# アーティスト外部リンクのアイコン表示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アーティスト詳細ページに散らばっている3種類のリンク表示(ヘッダーのApple Music/Spotifyボタン、公式サイト/X/Instagramのテキストリンク、下部のExternal Linksテキストチップ)を、カテゴリ分けされたブランドカラーの円形アイコン1ブロックに統合する。

**Architecture:** `simple-icons`パッケージ(ブランドSVGアイコン+ブランドカラーのデータのみを提供する軽量ライブラリ)を新規依存として追加し、`utils/serviceIcons.ts`でURLホスト名からアイコンを引くユーティリティを、`app/components/ArtistLinkIcons.tsx`で3カテゴリ(視聴/公式・SNS/情報)にグループ化した円形アイコン一覧を描画するServer Componentを実装する。`app/artists/[id]/page.tsx`の該当箇所をこのコンポーネント呼び出し1つに置き換える。ページ全体のレイアウト(中央1カラム)は変更しない。

**Tech Stack:** Next.js App Router (Server Components), React 19, Tailwind CSS v4, `simple-icons`(新規依存、個別アイコンの名前付きインポートでtree-shake)。

## Global Constraints

- ページ全体のレイアウト(`max-w-3xl`の中央1カラム)は変更しない。変更対象はリンク表示部分のみ。
- `simple-icons`は個別アイコンを名前付きインポートする(`import { siSpotify } from 'simple-icons'`)。ライブラリ全体を読み込む書き方(`import * as si from 'simple-icons'`)は禁止— バンドルサイズが肥大化する。
- アイコンはブランドカラー(`simple-icons`が提供する`hex`)を背景色にした円形バッジで表示する。ブランドアイコンが存在しないサービス(AllMusic・Qobuz・Amazon Music・AWA・公式サイト等)は、モノクロの汎用外部リンクアイコン(下記Material Symbols "link"のpathを使用、既存のダークテーマのトーン`text-white/60`系に合わせる)にフォールバックする。
- 各アイコンリンクには`aria-label`と`title`にサービス名を設定する(アイコンのみでは判別できないため)。
- カテゴリ分け(既存データから導出、新しい列・テーブルは追加しない):
  - **視聴**: `apple_music_artist_id` / `spotify_artist_id` + `artist_external_link`の`link_type`が`streaming`・`free streaming`・`youtube`・`youtube music`の行
  - **公式・SNS**: `official_site_url` / `sns_x_url` / `sns_instagram_url` + `artist_external_link`の`link_type`が`social network`の行
  - **情報**: `artist_external_link`の`link_type`が`other databases`・`allmusic`・`discogs`・`wikidata`・`IMDb`の行
- カテゴリ内にリンクが1件も無ければそのカテゴリを非表示にする。3カテゴリすべて空ならブロック全体を非表示にする。
- 自動テストは追加しない。検証は`npx tsc --noEmit`と実機確認(King Gnu, Ado, リンクが1件も無いアーティストの3パターン)で行う。
- `simple-icons`のバージョンは`16.28.0`で以下のスラッグが確認済み: `siApplemusic`(hex `FA243C`)、`siSpotify`(`1ED760`)、`siX`(`000000`)、`siInstagram`(`FF0069`)、`siFacebook`(`0866FF`)、`siTiktok`(`000000`)、`siYoutube`(`FF0000`)、`siYoutubemusic`(`FF0000`)、`siDiscogs`(`333333`)、`siWikidata`(`006699`)、`siImdb`(`F5C518`)、`siSoundcloud`(`FF5500`)、`siTidal`(`000000`)、`siLine`(`00C300`)。**`siAllmusic`・`siQobuz`・`siAmazonmusic`・`siAwa`は存在しない**(確認済み) — これらは常にフォールバックアイコンになる。

---

### Task 1: サービスアイコンユーティリティ・アイコン表示コンポーネント・アーティストページへの統合

**Files:**
- Modify: `package.json`(`simple-icons`を依存に追加)
- Create: `utils/serviceIcons.ts`
- Create: `app/components/ArtistLinkIcons.tsx`
- Modify: `app/artists/[id]/page.tsx:1-5`(import)、`170-230`(ヘッダーのリンク行3箇所+External Linksセクションをコンポーネント呼び出し1つに置き換え)

**Interfaces:**
- Produces:
  - `utils/serviceIcons.ts`: `export type ServiceIcon = { title: string; hex: string; path: string }`、`export const GENERIC_LINK_ICON_PATH: string`、`export function getServiceIcon(url: string): ServiceIcon | null`
  - `app/components/ArtistLinkIcons.tsx`: `export default function ArtistLinkIcons(props: ArtistLinkIconsProps): JSX.Element`、`export type ArtistLinkIconsProps = { artistName: string; officialSiteUrl: string | null; snsXUrl: string | null; snsInstagramUrl: string | null; appleMusicArtistId: string | null; spotifyArtistId: string | null; externalLinks: { id: string; link_type: string; url: string }[] }`
- Consumes: `getLinkLabel`(`@/utils/musicbrainz`、既存、`app/artists/[id]/page.tsx`から`utils/musicbrainz`経由で既に使われているラベル関数をそのまま流用してアイコンの`title`/`aria-label`に使う)

- [ ] **Step 1: `simple-icons`を依存に追加する**

```bash
npm install simple-icons@16.28.0
```

- [ ] **Step 2: `utils/serviceIcons.ts`を作成する**

```ts
import {
  siApplemusic,
  siSpotify,
  siX,
  siInstagram,
  siFacebook,
  siTiktok,
  siYoutube,
  siYoutubemusic,
  siDiscogs,
  siWikidata,
  siImdb,
  siSoundcloud,
  siTidal,
  siLine,
} from 'simple-icons'

export type ServiceIcon = {
  title: string
  hex: string
  path: string
}

// artist_external_link の URL ホスト名 -> ブランドアイコン。
// simple-icons に存在しないサービス(AllMusic・Qobuz・Amazon Music・AWA等)は
// このマップに含めず、呼び出し側で汎用フォールバックアイコンを使う。
const HOSTNAME_ICON: Record<string, ServiceIcon> = {
  'music.apple.com': siApplemusic,
  'open.spotify.com': siSpotify,
  'x.com': siX,
  'twitter.com': siX,
  'instagram.com': siInstagram,
  'facebook.com': siFacebook,
  'tiktok.com': siTiktok,
  'music.youtube.com': siYoutubemusic,
  'youtube.com': siYoutube,
  'discogs.com': siDiscogs,
  'wikidata.org': siWikidata,
  'imdb.com': siImdb,
  'soundcloud.com': siSoundcloud,
  'tidal.com': siTidal,
  'line.me': siLine,
}

// Material Symbols "link"(Apache-2.0)。ブランドアイコンが無いサービス用の
// 汎用フォールバックアイコン。
export const GENERIC_LINK_ICON_PATH =
  'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z'

/**
 * URLのホスト名からブランドアイコンを引く。サブドメイン(例: open.spotify.com
 * の www. 等)や末尾一致も許容する。マッチしない場合、またはURLとして不正な
 * 場合は null を返す(呼び出し側で汎用フォールバックアイコンを使う)。
 */
export function getServiceIcon(url: string): ServiceIcon | null {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '')
    if (HOSTNAME_ICON[hostname]) return HOSTNAME_ICON[hostname]
    for (const [domain, icon] of Object.entries(HOSTNAME_ICON)) {
      if (hostname.endsWith(`.${domain}`)) return icon
    }
    return null
  } catch {
    return null
  }
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: `app/components/ArtistLinkIcons.tsx`を作成する**

```tsx
import { siApplemusic, siSpotify, siX, siInstagram } from 'simple-icons'
import { getServiceIcon, GENERIC_LINK_ICON_PATH, type ServiceIcon } from '@/utils/serviceIcons'
import { getLinkLabel } from '@/utils/musicbrainz'

export type ArtistLinkIconsProps = {
  artistName: string
  officialSiteUrl: string | null
  snsXUrl: string | null
  snsInstagramUrl: string | null
  appleMusicArtistId: string | null
  spotifyArtistId: string | null
  externalLinks: { id: string; link_type: string; url: string }[]
}

type LinkItem = {
  key: string
  icon: ServiceIcon | null
  href: string
  label: string
}

const LISTEN_TYPES = new Set(['streaming', 'free streaming', 'youtube', 'youtube music'])
const SOCIAL_TYPE = 'social network'
const INFO_TYPES = new Set(['other databases', 'allmusic', 'discogs', 'wikidata', 'IMDb'])

function IconBadge({ item }: { item: LinkItem }) {
  if (item.icon) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noreferrer"
        title={item.label}
        aria-label={item.label}
        className="flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-80"
        style={{ backgroundColor: `#${item.icon.hex}` }}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="#fff">
          <path d={item.icon.path} />
        </svg>
      </a>
    )
  }
  return (
    <a
      href={item.href}
      target="_blank"
      rel="noreferrer"
      title={item.label}
      aria-label={item.label}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/60 transition hover:bg-white/10"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
        <path d={GENERIC_LINK_ICON_PATH} />
      </svg>
    </a>
  )
}

function CategoryRow({ label, items }: { label: string; items: LinkItem[] }) {
  if (items.length === 0) return null
  return (
    <div className="mt-3">
      <p className="text-xs uppercase tracking-wide text-white/40">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <IconBadge key={item.key} item={item} />
        ))}
      </div>
    </div>
  )
}

export default function ArtistLinkIcons({
  artistName,
  officialSiteUrl,
  snsXUrl,
  snsInstagramUrl,
  appleMusicArtistId,
  spotifyArtistId,
  externalLinks,
}: ArtistLinkIconsProps) {
  const listenItems: LinkItem[] = []
  if (appleMusicArtistId) {
    listenItems.push({
      key: 'apple-music',
      icon: siApplemusic,
      href: `https://music.apple.com/jp/artist/${encodeURIComponent(artistName)}/${appleMusicArtistId}`,
      label: 'Apple Music',
    })
  }
  if (spotifyArtistId) {
    listenItems.push({
      key: 'spotify',
      icon: siSpotify,
      href: `https://open.spotify.com/artist/${spotifyArtistId}`,
      label: 'Spotify',
    })
  }
  for (const link of externalLinks) {
    if (!LISTEN_TYPES.has(link.link_type)) continue
    listenItems.push({
      key: link.id,
      icon: getServiceIcon(link.url),
      href: link.url,
      label: getLinkLabel(link.url, link.link_type),
    })
  }

  const officialSnsItems: LinkItem[] = []
  if (officialSiteUrl) {
    officialSnsItems.push({ key: 'official', icon: null, href: officialSiteUrl, label: '公式サイト' })
  }
  if (snsXUrl) {
    officialSnsItems.push({ key: 'x', icon: siX, href: snsXUrl, label: 'X' })
  }
  if (snsInstagramUrl) {
    officialSnsItems.push({ key: 'instagram', icon: siInstagram, href: snsInstagramUrl, label: 'Instagram' })
  }
  for (const link of externalLinks) {
    if (link.link_type !== SOCIAL_TYPE) continue
    officialSnsItems.push({
      key: link.id,
      icon: getServiceIcon(link.url),
      href: link.url,
      label: getLinkLabel(link.url, link.link_type),
    })
  }

  const infoItems: LinkItem[] = []
  for (const link of externalLinks) {
    if (!INFO_TYPES.has(link.link_type)) continue
    infoItems.push({
      key: link.id,
      icon: getServiceIcon(link.url),
      href: link.url,
      label: getLinkLabel(link.url, link.link_type),
    })
  }

  if (listenItems.length === 0 && officialSnsItems.length === 0 && infoItems.length === 0) {
    return null
  }

  return (
    <div>
      <CategoryRow label="視聴" items={listenItems} />
      <CategoryRow label="公式・SNS" items={officialSnsItems} />
      <CategoryRow label="情報" items={infoItems} />
    </div>
  )
}
```

- [ ] **Step 5: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 6: `app/artists/[id]/page.tsx`を変更する**

現在1行目〜5行目のimport群:

```tsx
import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { notFound } from 'next/navigation'
import { formatDate, extractYoutubeVideoId, ARTIST_STREAMING_STATUS_LABEL, ARTIST_TYPE_LABEL } from '@/utils/format'
import { getLinkLabel } from '@/utils/musicbrainz'
import RelationGraph, { type RelationEdge, type RelationNode } from '@/app/components/RelationGraph'
```

を次のように変更する(`getLinkLabel`の直接importを削除し、`ArtistLinkIcons`のimportを追加):

```tsx
import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { notFound } from 'next/navigation'
import { formatDate, extractYoutubeVideoId, ARTIST_STREAMING_STATUS_LABEL, ARTIST_TYPE_LABEL } from '@/utils/format'
import RelationGraph, { type RelationEdge, type RelationNode } from '@/app/components/RelationGraph'
import ArtistLinkIcons from '@/app/components/ArtistLinkIcons'
```

現在170〜230行目(ヘッダー内のApple Music/Spotifyボタン〜External Linksセクションまで)の全体:

```tsx
          <div className="mt-3 flex flex-wrap gap-2">
            {artist.apple_music_artist_id && (
              <a
                href={`https://music.apple.com/jp/artist/${encodeURIComponent(artist.name)}/${artist.apple_music_artist_id}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-white/15 px-3 py-1.5 text-xs hover:bg-white/5"
              >
                ▶ Apple Music
              </a>
            )}
            {artist.spotify_artist_id && (
              <a
                href={`https://open.spotify.com/artist/${artist.spotify_artist_id}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-white/15 px-3 py-1.5 text-xs hover:bg-white/5"
              >
                ▶ Spotify
              </a>
            )}
          </div>

          <div className="mt-3 flex gap-3 text-xs text-white/40">
            {artist.official_site_url && (
              <a href={artist.official_site_url} target="_blank" rel="noreferrer" className="hover:text-white/70">
                公式サイト
              </a>
            )}
            {artist.sns_x_url && (
              <a href={artist.sns_x_url} target="_blank" rel="noreferrer" className="hover:text-white/70">
                X
              </a>
            )}
            {artist.sns_instagram_url && (
              <a href={artist.sns_instagram_url} target="_blank" rel="noreferrer" className="hover:text-white/70">
                Instagram
              </a>
            )}
          </div>
        </div>
      </div>

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
                {getLinkLabel(link.url, link.link_type)}
              </a>
            ))}
          </div>
        </>
      )}
```

を次のように置き換える(ヘッダー内の`<div>`は維持し、中身をコンポーネント呼び出し1つにする。`SectionDivider`呼び出しとExternal Linksセクションは丸ごと削除):

```tsx
          <ArtistLinkIcons
            artistName={artist.name}
            officialSiteUrl={artist.official_site_url}
            snsXUrl={artist.sns_x_url}
            snsInstagramUrl={artist.sns_instagram_url}
            appleMusicArtistId={artist.apple_music_artist_id}
            spotifyArtistId={artist.spotify_artist_id}
            externalLinks={externalLinks ?? []}
          />
        </div>
      </div>
```

変更後、ヘッダーブロックの直後は`{artist.bio && (`のBiographyセクションに続く(このセクション自体は変更しない)。

- [ ] **Step 7: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 8: 開発サーバーで実機確認**

以下3パターンを確認する:

1. King Gnu(`artist.id = 'MS_ART_k5fiz18l'`、視聴・公式SNS・情報の3カテゴリすべてにリンクあり)の `/artists/MS_ART_k5fiz18l` を開き、3つのカテゴリ行が表示され、各アイコンが正しいブランドカラー・正しいリンク先(クリックで正しいURLが新しいタブで開く)になっていることを確認する。AllMusicなど`simple-icons`に無いサービスがモノクロの汎用フォールバックアイコンで表示されることを確認する。
2. Ado(`/admin/data/artists/[id]/musicbrainz`から検索・取り込み済みであることを前提。未取り込みならこのタスクの検証の一環として取り込みを行ってよい)のページで同様に表示を確認する。
3. `artist_external_link`が1件も無く、かつ`official_site_url`/`sns_x_url`/`sns_instagram_url`/`apple_music_artist_id`/`spotify_artist_id`もすべて未設定のアーティストのページで、アイコンブロック自体が表示されないことを確認する(該当アーティストが無ければ、開発環境で一時的に何か1件のフィールドをnullにして確認し、確認後に元に戻す)。
4. 各アイコンにマウスオーバーし、ツールチップ(`title`)でサービス名が表示されることを確認する。

- [ ] **Step 9: コミット**

```bash
git add package.json package-lock.json utils/serviceIcons.ts app/components/ArtistLinkIcons.tsx app/artists/\[id\]/page.tsx
git commit -m "feat: consolidate artist links into categorized brand-icon display"
```

---

## Self-Review Notes

- **Spec coverage:** ゴール3点(3箇所のリンク表示統合、カテゴリ別ブランドアイコン表示、`aria-label`/`title`によるアクセシビリティ確保)をすべてTask 1でカバー。非ゴール(2カラムレイアウトへの変更、データ取得ロジックの変更、新リンク種別の追加)はいずれも本タスクで手を加えていない。
- **Placeholder scan:** なし。全ステップに実コードを記載。
- **Type consistency:** `ServiceIcon`型(`utils/serviceIcons.ts`)のフィールド名(`title`/`hex`/`path`)は`ArtistLinkIcons.tsx`の`LinkItem.icon`で一貫して使用。`ArtistLinkIconsProps`のフィールド名は`page.tsx`から渡す値と一致(`officialSiteUrl`←`artist.official_site_url`等)。
