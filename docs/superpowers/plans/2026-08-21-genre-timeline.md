# ジャンル年表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ジャンルの発祥年・発祥地・派生関係をWikipediaから取り込み、`/genres/[id]`に発祥・サブジャンル派生・代表アーティスト/作品・タグ付きアーティストのリリースを1本の年表にまとめた公開ページを追加する。

**Architecture:** Wikipediaの`{{Infobox music genre}}`テンプレートを生wikitextで取得・正規表現解析するユーティリティ(`utils/wikipediaGenre.ts`)を新設し、既存のMusicBrainzレーベル検索と同じ「検索→プレビュー→人間が確認して取込」パターンで管理画面から`genre`テーブルの発祥情報と`genre_lineage`(親子ジャンル)テーブルを埋める。公開ページはレーベル年表(`app/labels/[id]/LabelTimeline.tsx`)と同じ「サーバーコンポーネントが取得済みデータを渡し、純粋関数がマージ・ソートする」構成を踏襲する。

**Tech Stack:** Next.js App Router (Server Actions), Supabase (Postgres), TypeScript, `node:test`(`npm test`)。新規外部依存なし(Wikipedia REST APIをfetchで直接叩く)。

**Spec:** `docs/superpowers/specs/2026-08-21-genre-timeline-design.md`

## Global Constraints

- Wikipedia取込は日本語版を先に試し、インフォボックスが見つからなければ英語版にフォールバックする
- Wikipediaの起源/派生ジャンル名を既存`genre.name`に自動リンクするのは、ilikeで**厳密に1件だけ**一致した場合のみ(0件・2件以上はスキップし、テキストのまま管理画面に残す。過剰マッチ回避)
- 158件のジャンルを一括自動取込することはしない。管理画面から1件ずつ検索→確認して取り込む
- 新規テーブルの主キーは`bigint GENERATED ALWAYS AS IDENTITY`とする(既存の`award_entry`/`disc_guide_selection`と同じ規約。`genre`本体のような`MS_XXX_`形式のテキストIDは使わない)
- 年表の日付が無い行(origin_yearが未設定なジャンル、release_dateが無いリリース等)は年表から除外する(既存のレーベル年表・アーティスト年表と同じ方針)
- テストは`node:test`(`npm test`で`__tests__/**/*.test.ts`を実行)。マージ・ソートのような純粋関数はユニットテスト、外部API呼び出しは実APIを叩く統合テストとする(既存の`__tests__/label-timeline.unit.test.ts`・`__tests__/musicbrainz-label-search.integration.test.ts`と同じ形式)
- UIは既存の`app/admin/data/adminUi.ts`の`inputClass`/`buttonClass`、`app/admin/data/SearchableSelect.tsx`を再利用する。新規CSSクラスやコンポーネントライブラリは追加しない

---

### Task 1: データベーススキーマ

**Files:**
- Create: `supabase/migrations/20260821_add_genre_lineage.sql`

**Interfaces:**
- Produces: `genre.origin_country`(text, nullable)、`genre.origin_city`(text, nullable)、`genre.wikipedia_url`(text, nullable)。`genre_lineage(id bigint, parent_genre_id text, child_genre_id text)`、`genre_highlight(id bigint, genre_id text, artist_id text nullable, album_id text nullable, note text nullable)`。以降の全タスクがこれらの列・テーブルを使う。

- [ ] **Step 1: マイグレーションファイルを作成**

`supabase/migrations/20260821_add_genre_lineage.sql`:

```sql
-- ジャンル年表: Wikipediaから取り込む発祥地情報、ジャンル間の派生関係、
-- 代表アーティスト/作品を保持するためのカラム・テーブルを追加する。

ALTER TABLE genre ADD COLUMN origin_country TEXT;
ALTER TABLE genre ADD COLUMN origin_city TEXT;
ALTER TABLE genre ADD COLUMN wikipedia_url TEXT;

-- 1ジャンルの起源・派生は複数ありうる(例: Technoは House/electro/synth-pop等
-- 複数ジャンルに由来する)ため、単一のparent_genre_id列ではなく多対多の
-- 中間テーブルにする。
CREATE TABLE genre_lineage (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_genre_id TEXT NOT NULL REFERENCES genre(id) ON DELETE CASCADE,
  child_genre_id TEXT NOT NULL REFERENCES genre(id) ON DELETE CASCADE,
  UNIQUE (parent_genre_id, child_genre_id)
);

-- ジャンル(またはサブジャンル)ごとの代表アーティスト/作品。disc_guide_selectionと
-- 同じ「人間が選んで登録する」パターン。
CREATE TABLE genre_highlight (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  genre_id TEXT NOT NULL REFERENCES genre(id) ON DELETE CASCADE,
  artist_id TEXT REFERENCES artist(id) ON DELETE CASCADE,
  album_id TEXT REFERENCES album(id) ON DELETE CASCADE,
  note TEXT,
  CHECK (artist_id IS NOT NULL OR album_id IS NOT NULL)
);
```

- [ ] **Step 2: Supabase MCPの`apply_migration`で適用**

`name`は`add_genre_lineage`、`query`は上記SQL全体。適用後、`list_tables`で`genre_lineage`/`genre_highlight`が存在し、`genre`に3列追加されていることを確認する。

- [ ] **Step 3: コミット**

```bash
git add supabase/migrations/20260821_add_genre_lineage.sql
git commit -m "feat: add genre lineage and highlight tables for genre timeline"
```

---

### Task 2: Wikipediaジャンル情報取込ユーティリティ

**Files:**
- Create: `utils/wikipediaGenre.ts`
- Test: `__tests__/wikipedia-genre.unit.test.ts`
- Test: `__tests__/wikipedia-genre.integration.test.ts`

**Interfaces:**
- Consumes: なし(標準`fetch`のみ)
- Produces: `export type WikipediaGenreInfo = { sourceUrl: string; originYear: number | null; originPlace: string | null; stylisticOrigins: string[]; subgenres: string[]; derivatives: string[] }`、`export function parseGenreInfobox(wikitext: string, sourceUrl: string): WikipediaGenreInfo | null`(純粋関数、Task内でユニットテスト対象)、`export async function searchWikipediaGenre(name: string): Promise<WikipediaGenreInfo | null>`(Task 4のadmin actionsから呼ばれる)

- [ ] **Step 1: ユニットテストを書く(オフライン、固定wikitextで検証)**

`__tests__/wikipedia-genre.unit.test.ts`:

```typescript
// __tests__/wikipedia-genre.unit.test.ts
//
// Wikipediaの{{Infobox music genre}}wikitext解析ロジックのユニットテスト。
// 実際にen.wikipedia.org/Techno、ja.wikipedia.org/シティ・ポップから取得した
// 生wikitextを元にした固定データで検証する(ネットワーク不要)。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseGenreInfobox } from '../utils/wikipediaGenre.ts'

const TECHNO_WIKITEXT = `{{Infobox music genre <!-- See Wikipedia:WikiProject Music genres -->
| name              = Techno
| stylistic_origins = {{hlist|[[House music|House]]|[[Electro (music)|electro]]|[[synth-pop]]}}
| cultural_origins  = Mid-1980s, [[Detroit]], [[Michigan]], U.S.
| derivatives       = {{hlist|[[Alternative dance]]|[[trance music|trance]]}}
| subgenres         = {{hlist|[[Acid techno]]|[[Detroit techno]]|[[Minimal techno]]}}
}}
Techno is a genre of electronic dance music...`

const CITY_POP_WIKITEXT = `{{Infobox music genre
|name= シティ・ポップ
|image= File:A walk around Brickell Key-jikatu.jpg
|color=black
|bgcolor=#87CEEB
|stylistic_origins = {{Hlist-comma|[[ニューミュージック]]|[[AOR]]|[[湘南サウンド]]}}
|cultural_origins = {{Plainlist|
* [[1970年代]]
* {{JPN}}
}}
|instruments =
|derivatives = {{Hlist-comma|[[渋谷系]]|[[ヴェイパーウェイヴ]]}}
|subgenrelist =
|subgenres =
|fusiongenres =
|regional_scenes = [[ポップ・クレアティフ]]
|other_topics = {{仮リンク|ヨット・ロック|en|Yacht rock}}、[[J-POP]]
}}
シティ・ポップは1970年代の日本で生まれた音楽ジャンル...`

describe('parseGenreInfobox', () => {
  test('parses English infobox (Techno): year from free text, place from wikilinks, link lists', () => {
    const info = parseGenreInfobox(TECHNO_WIKITEXT, 'https://en.wikipedia.org/wiki/Techno')
    assert.ok(info)
    assert.equal(info!.originYear, 1980)
    assert.equal(info!.originPlace, 'Detroit, Michigan')
    assert.deepEqual(info!.stylisticOrigins, ['House', 'electro', 'synth-pop'])
    assert.deepEqual(info!.subgenres, ['Acid techno', 'Detroit techno', 'Minimal techno'])
    assert.deepEqual(info!.derivatives, ['Alternative dance', 'trance'])
    assert.equal(info!.sourceUrl, 'https://en.wikipedia.org/wiki/Techno')
  })

  test('parses Japanese infobox (シティ・ポップ): Plainlist cultural_origins with a country template', () => {
    const info = parseGenreInfobox(CITY_POP_WIKITEXT, 'https://ja.wikipedia.org/wiki/シティ・ポップ')
    assert.ok(info)
    assert.equal(info!.originYear, 1970)
    assert.equal(info!.originPlace, '日本')
    assert.deepEqual(info!.stylisticOrigins, ['ニューミュージック', 'AOR', '湘南サウンド'])
    assert.deepEqual(info!.derivatives, ['渋谷系', 'ヴェイパーウェイヴ'])
    assert.deepEqual(info!.subgenres, [])
  })

  test('returns null when no Infobox music genre template is present', () => {
    const info = parseGenreInfobox('Just some article text with no infobox at all.', 'https://en.wikipedia.org/wiki/Nothing')
    assert.equal(info, null)
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- --test-name-pattern=parseGenreInfobox` (もしくは `npm test`)
Expected: FAIL(`../utils/wikipediaGenre.ts`が存在しないためモジュール解決エラー)

- [ ] **Step 3: `utils/wikipediaGenre.ts`を実装**

```typescript
// utils/wikipediaGenre.ts
//
// ジャンルの発祥年・発祥地・起源ジャンル・派生ジャンルを、Wikipediaの
// {{Infobox music genre}}テンプレートから取り込むためのユーティリティ。
// 日本語版を先に試し、記事/インフォボックスが無ければ英語版にフォールバックする
// (日本発ジャンルはja版、洋楽ジャンルはen版が充実している想定、実データで確認済み)。
// ジャンルには専用のAPIが無いため(MusicBrainzのgenreは単なるタグ)、Wikipedia
// REST API(action=parse&prop=wikitext)で生wikitextを取得し正規表現で解析する。

const USER_AGENT = 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'

export type WikipediaGenreInfo = {
  sourceUrl: string
  originYear: number | null
  originPlace: string | null
  stylisticOrigins: string[]
  subgenres: string[]
  derivatives: string[]
}

async function fetchWikitext(
  lang: 'ja' | 'en',
  title: string
): Promise<{ wikitext: string; resolvedTitle: string } | null> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&format=json&prop=wikitext&section=0&redirects=1`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) return null
  const data = await res.json()
  if (data.error) return null
  const wikitext = data.parse?.wikitext?.['*']
  const resolvedTitle = data.parse?.title
  if (!wikitext || !resolvedTitle) return null
  return { wikitext, resolvedTitle }
}

// {{...}}はネストしうる(インフォボックス内に{{hlist|...}}や{{cite news|...}}が
// 入れ子で現れる)ため、単純な非貪欲正規表現では閉じタグを取り違える。
// 開き位置から深さを数えて対応する閉じ位置を探す。
function findMatchingClose(text: string, openIndex: number): number {
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    if (text.startsWith('{{', i)) {
      depth++
      i++
    } else if (text.startsWith('}}', i)) {
      depth--
      i++
      if (depth === 0) return i + 1
    }
  }
  return -1
}

function extractInfobox(wikitext: string): string | null {
  const match = wikitext.match(/\{\{\s*Infobox music genre/i)
  if (!match || match.index === undefined) return null
  const end = findMatchingClose(wikitext, match.index)
  if (end === -1) return null
  return wikitext.slice(match.index, end)
}

function extractFieldRaw(infobox: string, field: string): string | null {
  const re = new RegExp(`\\|\\s*${field}\\s*=([\\s\\S]*?)(?=\\n\\s*\\|[a-zA-Z_]+\\s*=|\\n\\}\\}\\s*$)`, 'i')
  const m = infobox.match(re)
  return m ? m[1].trim() : null
}

// [[記事名|表示名]] または [[記事名]] から表示用の名前だけを順番に取り出す。
// {{hlist|...}}/{{Plainlist|...}}のようなラッパーテンプレートは中のリンクだけ
// 拾えば十分で、{{JPN}}のような他のテンプレートは(リンク構文ではないため)
// 自然に無視される。
function extractLinkNames(text: string): string[] {
  const names: string[] = []
  const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const name = (m[2] ?? m[1]).trim()
    if (name) names.push(name)
  }
  return names
}

const COUNTRY_TEMPLATE_JA: Record<string, string> = {
  JPN: '日本',
  USA: 'アメリカ合衆国',
  GBR: 'イギリス',
  FRA: 'フランス',
  DEU: 'ドイツ',
  JAM: 'ジャマイカ',
}

// cultural_origins欄は書式が英語版・日本語版で大きく異なる:
//   英語版: 自由文 "Mid-1980s, [[Detroit]], [[Michigan]], U.S."
//   日本語版: {{Plainlist| * [[1970年代]] * {{JPN}} }} のような箇条書き+国旗テンプレート
// どちらのパターンにも対応するため、リンク由来の年/地名、国旗テンプレート由来の
// 国名、自由文由来の年をそれぞれ試し、取れたものを組み合わせるベストエフォート方式にする
// (都市までは分離しない場合がある、という前提はspec通り)。
function extractCulturalOrigin(fieldRaw: string): { year: number | null; place: string | null } {
  const countryNames: string[] = []
  const templateRe = /\{\{\s*([A-Za-z]{2,5})\s*\}\}/g
  let tm: RegExpExecArray | null
  while ((tm = templateRe.exec(fieldRaw))) {
    const jaName = COUNTRY_TEMPLATE_JA[tm[1].toUpperCase()]
    if (jaName) countryNames.push(jaName)
  }

  const linkNames = extractLinkNames(fieldRaw)
  const yearLink = linkNames.find((n) => /^\d{4}/.test(n))
  const placeFromLinks = linkNames.filter((n) => !/^\d{4}/.test(n))

  const plainText = fieldRaw
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, d) => d ?? a)
  const plainYearMatch = plainText.match(/\d{4}/)

  const yearSource = yearLink ?? (plainYearMatch ? plainYearMatch[0] : null)
  const year = yearSource ? parseInt(yearSource.slice(0, 4), 10) : null

  const placeParts = [...countryNames, ...placeFromLinks]
  if (placeParts.length === 0) {
    const withoutYear = plainText
      .replace(/\d{4}s?/, '')
      .replace(/^[,*\s]+|[,*\s]+$/g, '')
      .trim()
    if (withoutYear) placeParts.push(withoutYear)
  }

  return { year, place: placeParts.length > 0 ? placeParts.join(', ') : null }
}

export function parseGenreInfobox(wikitext: string, sourceUrl: string): WikipediaGenreInfo | null {
  const infobox = extractInfobox(wikitext)
  if (!infobox) return null

  const culturalRaw = extractFieldRaw(infobox, 'cultural_origins')
  const { year, place } = culturalRaw ? extractCulturalOrigin(culturalRaw) : { year: null, place: null }

  return {
    sourceUrl,
    originYear: year,
    originPlace: place,
    stylisticOrigins: extractLinkNames(extractFieldRaw(infobox, 'stylistic_origins') ?? ''),
    subgenres: extractLinkNames(extractFieldRaw(infobox, 'subgenres') ?? ''),
    derivatives: extractLinkNames(extractFieldRaw(infobox, 'derivatives') ?? ''),
  }
}

export async function searchWikipediaGenre(name: string): Promise<WikipediaGenreInfo | null> {
  for (const lang of ['ja', 'en'] as const) {
    const fetched = await fetchWikitext(lang, name)
    if (!fetched) continue
    const sourceUrl = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(fetched.resolvedTitle.replace(/ /g, '_'))}`
    const info = parseGenreInfobox(fetched.wikitext, sourceUrl)
    if (info) return info
  }
  return null
}
```

- [ ] **Step 4: ユニットテストを実行して通過を確認**

Run: `npm test`
Expected: `wikipedia-genre.unit.test.ts`の3件が全てPASS

- [ ] **Step 5: 統合テストを書く(実際にWikipediaへ問い合わせる)**

`__tests__/wikipedia-genre.integration.test.ts`:

```typescript
// __tests__/wikipedia-genre.integration.test.ts
//
// Wikipedia REST APIを実際に叩き、レスポンスの解析結果が想定通りであることを確認する。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { searchWikipediaGenre } from '../utils/wikipediaGenre.ts'

describe('searchWikipediaGenre', () => {
  test('finds Techno on English Wikipedia with a Detroit origin', async () => {
    const info = await searchWikipediaGenre('Techno')
    assert.ok(info, 'expected a result')
    assert.equal(info!.originYear, 1980)
    assert.ok(info!.originPlace?.includes('Detroit'), `expected originPlace to include Detroit, got: ${info!.originPlace}`)
    assert.ok(info!.subgenres.length > 0)
  })

  test('finds シティ・ポップ on Japanese Wikipedia (via redirect from シティーポップ) with a 1970s/Japan origin', async () => {
    const info = await searchWikipediaGenre('シティーポップ')
    assert.ok(info, 'expected a result')
    assert.equal(info!.originYear, 1970)
    assert.equal(info!.originPlace, '日本')
    assert.ok(info!.sourceUrl.includes('wikipedia.org'))
  })

  test('returns null for a nonexistent genre name', async () => {
    const info = await searchWikipediaGenre('zzzznonexistentgenrexyz123')
    assert.equal(info, null)
  })
})
```

- [ ] **Step 6: 統合テストを実行して通過を確認**

Run: `npm test`
Expected: `wikipedia-genre.integration.test.ts`の3件が全てPASS(Wikipediaの記事内容が将来編集されて数値がずれた場合はこのテストを実データに合わせて更新する)

- [ ] **Step 7: コミット**

```bash
git add utils/wikipediaGenre.ts __tests__/wikipedia-genre.unit.test.ts __tests__/wikipedia-genre.integration.test.ts
git commit -m "feat: add Wikipedia genre infobox lookup utility"
```

---

### Task 3: ジャンル年表マージ・ソートロジック

**Files:**
- Create: `utils/genreTimeline.ts`
- Test: `__tests__/genre-timeline.unit.test.ts`

**Interfaces:**
- Consumes: なし(純粋関数)
- Produces: `export type GenreTimelineEntry = { date: string; kind: 'origin' | 'derived' | 'release' | 'highlight'; title: string; subtitle: string | null; href: string | null; indent: boolean }`、`export type GenreTimelineInput = { genreId: string; genreName: string; originYear: number | null; originPlace: string | null; children: { genreId: string; genreName: string; originYear: number | null; originPlace: string | null }[]; highlights: { genreId: string; artistId: string | null; artistName: string | null; albumId: string | null; albumTitle: string | null; note: string | null }[]; releases: { albumId: string; albumTitle: string; artistName: string; releaseDate: string | null }[] }`、`export function buildGenreTimeline(input: GenreTimelineInput): GenreTimelineEntry[]`(Task 7のGenreTimeline.tsxが呼ぶ)

- [ ] **Step 1: ユニットテストを書く**

`__tests__/genre-timeline.unit.test.ts`:

```typescript
// __tests__/genre-timeline.unit.test.ts
//
// ジャンル年表のマージ・ソートロジックのユニットテスト。DB/サーバ不要、純粋関数のみ。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildGenreTimeline } from '../utils/genreTimeline.ts'

describe('buildGenreTimeline', () => {
  test('orders origin, derived subgenres, highlights, and releases chronologically', () => {
    const entries = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'Techno',
      originYear: 1985,
      originPlace: 'Detroit, Michigan',
      children: [{ genreId: 'g2', genreName: 'Acid Techno', originYear: 1987, originPlace: 'Chicago' }],
      highlights: [
        { genreId: 'g1', artistId: 'a1', artistName: 'Juan Atkins', albumId: null, albumTitle: null, note: null },
      ],
      releases: [
        { albumId: 'al1', albumTitle: "No UFO's", artistName: 'Model 500', releaseDate: '1985-05-01' },
      ],
    })

    assert.deepEqual(
      entries.map((e) => [e.date, e.kind]),
      [
        ['1985-01-01', 'origin'],
        ['1985-01-01', 'highlight'],
        ['1985-05-01', 'release'],
        ['1987-01-01', 'derived'],
      ]
    )
    assert.equal(entries[0].title, 'Techno 発祥')
    assert.equal(entries[0].subtitle, 'Detroit, Michigan')
    assert.equal(entries[0].indent, false)
    assert.equal(entries[1].title, '代表: Juan Atkins')
    assert.equal(entries[1].indent, false)
    assert.equal(entries[2].title, "Model 500「No UFO's」リリース")
    assert.equal(entries[2].href, '/albums/al1')
    assert.equal(entries[3].title, 'Acid Technoが派生')
    assert.equal(entries[3].subtitle, 'Chicago')
    assert.equal(entries[3].href, '/genres/g2')
    assert.equal(entries[3].indent, true)
  })

  test('omits the origin entry when originYear is null', () => {
    const entries = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'X',
      originYear: null,
      originPlace: null,
      children: [],
      highlights: [],
      releases: [],
    })
    assert.deepEqual(entries, [])
  })

  test('omits a child derived entry with no originYear, and a highlight whose genre has no resolvable year', () => {
    const entries = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'X',
      originYear: 1970,
      originPlace: null,
      children: [{ genreId: 'g2', genreName: 'Y (no year)', originYear: null, originPlace: null }],
      highlights: [
        { genreId: 'g3', artistId: 'a1', artistName: 'Unrelated', albumId: null, albumTitle: null, note: null },
      ],
      releases: [],
    })
    assert.deepEqual(entries.map((e) => e.kind), ['origin'])
  })

  test('highlight title combines artist and album when both are present', () => {
    const entries = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'X',
      originYear: 1970,
      originPlace: null,
      children: [],
      highlights: [
        { genreId: 'g1', artistId: 'a1', artistName: 'Artist A', albumId: 'al1', albumTitle: 'Album A', note: null },
      ],
      releases: [],
    })
    assert.equal(entries[1].title, '代表: Artist A「Album A」')
  })

  test('highlight title falls back to album title alone when artistName is null', () => {
    const entries = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'X',
      originYear: 1970,
      originPlace: null,
      children: [],
      highlights: [
        { genreId: 'g1', artistId: null, artistName: null, albumId: 'al1', albumTitle: 'Album A', note: null },
      ],
      releases: [],
    })
    assert.equal(entries[1].title, '代表: 「Album A」')
  })

  test('release entries with no releaseDate are omitted', () => {
    const entries = buildGenreTimeline({
      genreId: 'g1',
      genreName: 'X',
      originYear: null,
      originPlace: null,
      children: [],
      highlights: [],
      releases: [{ albumId: 'al1', albumTitle: 'Unreleased', artistName: 'Someone', releaseDate: null }],
    })
    assert.deepEqual(entries, [])
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test`
Expected: FAIL(`../utils/genreTimeline.ts`が存在しない)

- [ ] **Step 3: `utils/genreTimeline.ts`を実装**

```typescript
// utils/genreTimeline.ts
//
// ジャンル詳細ページが既に取得済みのデータ(発祥情報・サブジャンル・代表アーティスト/
// 作品・タグ付きアーティストのリリース)を、日付が分かる出来事だけ時系列1本のリストへ
// マージする。サブジャンル/派生ジャンルとその代表作品の行はindent=trueにして、
// 親ジャンルから枝分かれしていることを示す(app/genres/[id]/GenreTimeline.tsxが
// インデント表示に使う)。日付を持たない行は年表から除外する。

export type GenreTimelineEntry = {
  date: string
  kind: 'origin' | 'derived' | 'release' | 'highlight'
  title: string
  subtitle: string | null
  href: string | null
  indent: boolean
}

export type GenreTimelineInput = {
  genreId: string
  genreName: string
  originYear: number | null
  originPlace: string | null
  children: { genreId: string; genreName: string; originYear: number | null; originPlace: string | null }[]
  highlights: {
    genreId: string
    artistId: string | null
    artistName: string | null
    albumId: string | null
    albumTitle: string | null
    note: string | null
  }[]
  releases: { albumId: string; albumTitle: string; artistName: string; releaseDate: string | null }[]
}

function highlightTitle(h: GenreTimelineInput['highlights'][number]): string {
  if (h.albumTitle) {
    return h.artistName ? `代表: ${h.artistName}「${h.albumTitle}」` : `代表: 「${h.albumTitle}」`
  }
  return `代表: ${h.artistName ?? ''}`
}

export function buildGenreTimeline(input: GenreTimelineInput): GenreTimelineEntry[] {
  const entries: GenreTimelineEntry[] = []

  if (input.originYear) {
    entries.push({
      date: `${input.originYear}-01-01`,
      kind: 'origin',
      title: `${input.genreName} 発祥`,
      subtitle: input.originPlace,
      href: null,
      indent: false,
    })
  }

  for (const child of input.children) {
    if (!child.originYear) continue
    entries.push({
      date: `${child.originYear}-01-01`,
      kind: 'derived',
      title: `${child.genreName}が派生`,
      subtitle: child.originPlace,
      href: `/genres/${child.genreId}`,
      indent: true,
    })
  }

  const originYearByGenre = new Map<string, number>()
  if (input.originYear) originYearByGenre.set(input.genreId, input.originYear)
  for (const child of input.children) {
    if (child.originYear) originYearByGenre.set(child.genreId, child.originYear)
  }

  for (const h of input.highlights) {
    const year = originYearByGenre.get(h.genreId)
    if (!year) continue
    entries.push({
      date: `${year}-01-01`,
      kind: 'highlight',
      title: highlightTitle(h),
      subtitle: h.note,
      href: h.albumId ? `/albums/${h.albumId}` : h.artistId ? `/artists/${h.artistId}` : null,
      indent: h.genreId !== input.genreId,
    })
  }

  for (const release of input.releases) {
    if (!release.releaseDate) continue
    entries.push({
      date: release.releaseDate,
      kind: 'release',
      title: `${release.artistName}「${release.albumTitle}」リリース`,
      subtitle: null,
      href: `/albums/${release.albumId}`,
      indent: false,
    })
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date))
}
```

- [ ] **Step 4: テストを実行して通過を確認**

Run: `npm test`
Expected: `genre-timeline.unit.test.ts`の6件が全てPASS

- [ ] **Step 5: コミット**

```bash
git add utils/genreTimeline.ts __tests__/genre-timeline.unit.test.ts
git commit -m "feat: add genre timeline merge/sort logic"
```

---

### Task 4: 管理画面アクション — Wikipedia取込・派生リンク

**Files:**
- Modify: `app/admin/data/genres/actions.ts`

**Interfaces:**
- Consumes: `searchWikipediaGenre`/`WikipediaGenreInfo` from `utils/wikipediaGenre.ts`(Task 2)
- Produces: `export async function lookupWikipediaGenre(name: string): Promise<WikipediaGenreInfo | null>`、`export async function applyWikipediaGenreLookup(formData: FormData): Promise<void>`(Task 6のWikipediaGenreSearch.tsxが呼ぶ)

- [ ] **Step 1: `app/admin/data/genres/actions.ts`に追記**

既存の`createGenre`/`linkArtistGenre`の下に追加(ファイル冒頭のimportに`searchWikipediaGenre`と型を追加):

```typescript
import { searchWikipediaGenre, type WikipediaGenreInfo } from '@/utils/wikipediaGenre'
```

ファイル末尾に追記:

```typescript
export async function lookupWikipediaGenre(name: string): Promise<WikipediaGenreInfo | null> {
  return searchWikipediaGenre(name)
}

/** Wikipediaから取り込んだ発祥情報を対象ジャンルへ反映し、起源/派生/サブジャンル名を
 * 既存のgenre.nameとilikeで照合する。ilikeで厳密に1件だけ一致した場合のみ
 * genre_lineageへ自動リンクする(0件・2件以上は過剰マッチ回避のためスキップし、
 * 管理画面には未リンクの名前として残す)。 */
export async function applyWikipediaGenreLookup(formData: FormData) {
  const genreId = String(formData.get('genre_id') ?? '')
  const sourceUrl = String(formData.get('source_url') ?? '')
  const originYearRaw = String(formData.get('origin_year') ?? '').trim()
  const originPlace = String(formData.get('origin_place') ?? '').trim()
  const stylisticOrigins: string[] = JSON.parse(String(formData.get('stylistic_origins_json') ?? '[]'))
  const subgenres: string[] = JSON.parse(String(formData.get('subgenres_json') ?? '[]'))
  const derivatives: string[] = JSON.parse(String(formData.get('derivatives_json') ?? '[]'))

  if (!genreId) {
    redirectWith('error', '対象ジャンルを選択してください。')
  }

  const supabase = createAdminClient()

  const update: Record<string, unknown> = { wikipedia_url: sourceUrl || null }
  if (originYearRaw) update.origin_year = Number(originYearRaw)
  if (originPlace) update.origin_country = originPlace

  const { error: updateError } = await supabase.from('genre').update(update).eq('id', genreId)
  if (updateError) {
    redirectWith('error', `ジャンルの更新に失敗しました: ${updateError.message}`)
  }

  let linkedCount = 0
  const unmatched: string[] = []

  async function linkIfUnambiguous(name: string, direction: 'origin' | 'derived') {
    const { data: matches } = await supabase.from('genre').select('id').ilike('name', name).limit(2)
    if (!matches || matches.length !== 1) {
      unmatched.push(name)
      return
    }
    const matchedId = matches[0].id
    if (matchedId === genreId) return // 自己参照は無視
    const parentId = direction === 'origin' ? matchedId : genreId
    const childId = direction === 'origin' ? genreId : matchedId
    const { error } = await supabase
      .from('genre_lineage')
      .upsert({ parent_genre_id: parentId, child_genre_id: childId }, { onConflict: 'parent_genre_id,child_genre_id', ignoreDuplicates: true })
    if (!error) linkedCount++
  }

  for (const name of stylisticOrigins) {
    await linkIfUnambiguous(name, 'origin')
  }
  for (const name of [...subgenres, ...derivatives]) {
    await linkIfUnambiguous(name, 'derived')
  }

  revalidatePath('/admin/data/genres')
  revalidatePath(`/genres/${genreId}`)

  const parts = [`Wikipediaから情報を取り込みました。`]
  if (linkedCount > 0) parts.push(`自動リンク${linkedCount}件。`)
  if (unmatched.length > 0) parts.push(`未登録のジャンル名: ${unmatched.join(', ')}`)
  redirectWith('success', parts.join(''))
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add app/admin/data/genres/actions.ts
git commit -m "feat: add Wikipedia genre lookup and lineage auto-linking actions"
```

---

### Task 5: 管理画面アクション — 代表アーティスト/作品CRUD

**Files:**
- Modify: `app/admin/data/genres/actions.ts`
- Modify: `app/admin/data/actions.ts`

**Interfaces:**
- Consumes: なし
- Produces: `export async function addGenreHighlight(formData: FormData): Promise<void>`、`export async function deleteGenreHighlight(formData: FormData): Promise<void>`(Task 6のgenres/page.tsxが呼ぶ)。`export async function searchArtists(query: string): Promise<PickerItem[]>`(Task 6のSearchableSelectが呼ぶ)

- [ ] **Step 1: `app/admin/data/actions.ts`に`searchArtists`を追記**

`searchAlbums`の直後に追加:

```typescript
export async function searchArtists(query: string): Promise<PickerItem[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const supabase = await createClient()
  const { data } = await supabase.from('artist').select('id, name').ilike('name', `%${trimmed}%`).limit(20)
  return (data ?? []).map((a) => ({ id: a.id, label: a.name }))
}
```

- [ ] **Step 2: `app/admin/data/genres/actions.ts`に`addGenreHighlight`/`deleteGenreHighlight`を追記**

```typescript
export async function addGenreHighlight(formData: FormData) {
  const genreId = String(formData.get('genre_id') ?? '')
  const artistId = String(formData.get('artist_id') ?? '').trim()
  const albumId = String(formData.get('album_id') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim()

  if (!genreId || (!artistId && !albumId)) {
    redirectWith('error', 'ジャンルと、アーティストまたはアルバムを指定してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('genre_highlight').insert({
    genre_id: genreId,
    artist_id: artistId || null,
    album_id: albumId || null,
    note: note || null,
  })

  if (error) {
    redirectWith('error', `代表アーティスト/作品の登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/genres')
  revalidatePath(`/genres/${genreId}`)
  redirectWith('success', '代表アーティスト/作品を登録しました。')
}

export async function deleteGenreHighlight(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const genreId = String(formData.get('genre_id') ?? '')

  if (!id) {
    redirectWith('error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('genre_highlight').delete().eq('id', id)

  if (error) {
    redirectWith('error', `削除に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/genres')
  if (genreId) revalidatePath(`/genres/${genreId}`)
  redirectWith('success', '削除しました。')
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add app/admin/data/genres/actions.ts app/admin/data/actions.ts
git commit -m "feat: add genre highlight CRUD actions and artist search"
```

---

### Task 6: 管理画面UI — Wikipedia検索・代表アーティスト/作品フォーム

**Files:**
- Create: `app/admin/data/genres/WikipediaGenreSearch.tsx`
- Modify: `app/admin/data/genres/page.tsx`

**Interfaces:**
- Consumes: `lookupWikipediaGenre`/`applyWikipediaGenreLookup`(Task 4)、`addGenreHighlight`/`deleteGenreHighlight`(Task 5)、`searchArtists`(Task 5)、`searchAlbums`(既存)、`WikipediaGenreInfo`型(Task 2)、`SearchableSelect`(既存)
- Produces: なし(末端UI)

- [ ] **Step 1: `app/admin/data/genres/WikipediaGenreSearch.tsx`を作成**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { lookupWikipediaGenre, applyWikipediaGenreLookup } from './actions'
import type { WikipediaGenreInfo } from '@/utils/wikipediaGenre'

export default function WikipediaGenreSearch({ genreOptions }: { genreOptions: { id: string; name: string }[] }) {
  const [genreId, setGenreId] = useState('')
  const [query, setQuery] = useState('')
  const [info, setInfo] = useState<WikipediaGenreInfo | null | undefined>(undefined)
  const [isPending, startTransition] = useTransition()

  function handleSearch() {
    if (!query.trim()) return
    startTransition(async () => {
      const result = await lookupWikipediaGenre(query.trim())
      setInfo(result)
    })
  }

  return (
    <div className="mt-6 rounded-md border border-white/15 p-4">
      <p className="text-xs text-white/40">Wikipediaでジャンルの発祥・派生関係を検索</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <select
          value={genreId}
          onChange={(e) => setGenreId(e.target.value)}
          className="w-full max-w-xs rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
        >
          <option value="" disabled>
            反映先のジャンルを選択
          </option>
          {genreOptions.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Wikipedia記事名(例: Techno, シティ・ポップ)"
          className="w-full max-w-xs rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={isPending}
          className="rounded-md border border-white/15 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
        >
          {isPending ? '検索中...' : '検索'}
        </button>
      </div>

      {info === null && <p className="mt-3 text-sm text-white/40">Wikipediaにインフォボックスが見つかりませんでした。</p>}

      {info && (
        <div className="mt-3 space-y-1.5 text-sm">
          <p>
            出典:{' '}
            <a href={info.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:text-blue-200">
              {info.sourceUrl}
            </a>
          </p>
          <p className="text-white/70">
            発祥: {info.originYear ?? '不明'}
            {info.originPlace ? ` / ${info.originPlace}` : ''}
          </p>
          {info.stylisticOrigins.length > 0 && (
            <p className="text-white/50">起源ジャンル: {info.stylisticOrigins.join(', ')}</p>
          )}
          {info.subgenres.length > 0 && <p className="text-white/50">サブジャンル: {info.subgenres.join(', ')}</p>}
          {info.derivatives.length > 0 && <p className="text-white/50">派生ジャンル: {info.derivatives.join(', ')}</p>}

          <form action={applyWikipediaGenreLookup} className="pt-1">
            <input type="hidden" name="genre_id" value={genreId} />
            <input type="hidden" name="source_url" value={info.sourceUrl} />
            <input type="hidden" name="origin_year" value={info.originYear ?? ''} />
            <input type="hidden" name="origin_place" value={info.originPlace ?? ''} />
            <input type="hidden" name="stylistic_origins_json" value={JSON.stringify(info.stylisticOrigins)} />
            <input type="hidden" name="subgenres_json" value={JSON.stringify(info.subgenres)} />
            <input type="hidden" name="derivatives_json" value={JSON.stringify(info.derivatives)} />
            <button
              type="submit"
              disabled={!genreId}
              className="rounded-md border border-white/15 px-3 py-1 text-xs hover:bg-white/5 disabled:opacity-40"
            >
              この内容で取込
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: `app/admin/data/genres/page.tsx`を編集**

importに追加:

```typescript
import SearchableSelect from '../SearchableSelect'
import { searchAlbums, searchArtists } from '../actions'
import { createGenre, linkArtistGenre, addGenreHighlight, deleteGenreHighlight } from './actions'
import WikipediaGenreSearch from './WikipediaGenreSearch'
```

(既存の`import { createGenre, linkArtistGenre } from './actions'`を上記の行で置き換える)

データ取得部分(`Promise.all`)に`genre_highlight`一覧を追加。既存の:

```typescript
  const [{ data: artists }, { data: genres }, { data: artistGenres }] = await Promise.all([
    supabase.from('artist').select('id, name').order('name'),
    supabase.from('genre').select('id, name').order('name'),
    supabase.from('artist_genre').select('artist:artist_id(name), genre:genre_id(name)').order('artist_id'),
  ])
```

を、次で置き換える:

```typescript
  const [{ data: artists }, { data: genres }, { data: artistGenres }, { data: highlights }] = await Promise.all([
    supabase.from('artist').select('id, name').order('name'),
    supabase.from('genre').select('id, name').order('name'),
    supabase.from('artist_genre').select('artist:artist_id(name), genre:genre_id(name)').order('artist_id'),
    supabase
      .from('genre_highlight')
      .select('id, note, genre:genre_id(id, name), artist:artist_id(name), album:album_id(title)')
      .order('id', { ascending: false }),
  ])
```

`<h1 className="mt-4 text-2xl font-bold">ジャンル</h1>`の直後、既存の`<form action={createGenre} ...>`の直前に追加:

```tsx
      <WikipediaGenreSearch genreOptions={genreOptions} />
```

ファイル内の既存`<form action={createGenre} ...>`〜`</form>`ブロックの後(「ジャンル追加」フォームの後)、既存の「アーティスト紐付け」フォーム(`<form action={linkArtistGenre} ...>`)の後に、ジャンル一覧(公開ページへのリンク)と代表アーティスト/作品フォームを追加:

```tsx
      {genreOptions.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2 text-sm text-white/60">
          {genreOptions.map((g) => (
            <li key={g.id} className="flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-0.5 text-xs">
              {g.name}
              <Link href={`/genres/${g.id}`} className="text-white/40 hover:text-white/70">
                →
              </Link>
            </li>
          ))}
        </ul>
      )}

      <form action={addGenreHighlight} className="mt-6 flex flex-wrap items-center gap-2">
        <select name="genre_id" required className={`${inputClass} max-w-xs`} defaultValue="">
          <option value="" disabled>
            ジャンルを選択
          </option>
          {genreOptions.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-white/40">の代表に</span>
        <SearchableSelect searchAction={searchArtists} name="artist_id" placeholder="アーティスト(任意)" />
        <SearchableSelect searchAction={searchAlbums} name="album_id" placeholder="作品(任意)" />
        <input name="note" placeholder="メモ(任意)" className={`${inputClass} max-w-[160px]`} />
        <button type="submit" className={buttonClass}>
          代表として登録
        </button>
      </form>

      {highlights && highlights.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-white/60">
          {highlights.map((row) => {
            const genre = Array.isArray(row.genre) ? row.genre[0] : row.genre
            const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
            const album = Array.isArray(row.album) ? row.album[0] : row.album
            return (
              <li key={row.id} className="flex items-center justify-between gap-2">
                <span>
                  {genre?.name} — {artist?.name}
                  {album?.title ? `「${album.title}」` : ''}
                  {row.note ? `(${row.note})` : ''}
                </span>
                <form action={deleteGenreHighlight}>
                  <input type="hidden" name="id" value={row.id} />
                  <input type="hidden" name="genre_id" value={genre?.id ?? ''} />
                  <button type="submit" className="shrink-0 text-xs text-white/40 hover:text-red-400">
                    削除
                  </button>
                </form>
              </li>
            )
          })}
        </ul>
      )}
```

- [ ] **Step 3: 型チェック・lint**

Run: `npx tsc --noEmit && npx eslint app/admin/data/genres/`
Expected: エラーなし

- [ ] **Step 4: 開発サーバーで手動確認**

Run: `npm run dev`。`/admin/data/genres`を開き、Wikipedia検索欄に「Techno」と入力して検索→発祥年/地・起源/派生ジャンル名がプレビューされることを確認。反映先ジャンルを選んで「この内容で取込」を押し、成功メッセージが出ることを確認。代表アーティスト/作品フォームも同様に1件登録して一覧に表示されることを確認。

- [ ] **Step 5: コミット**

```bash
git add app/admin/data/genres/WikipediaGenreSearch.tsx app/admin/data/genres/page.tsx
git commit -m "feat: add genre admin UI for Wikipedia lookup and representative works"
```

---

### Task 7: 公開ジャンル詳細ページ

**Files:**
- Create: `app/genres/[id]/page.tsx`
- Create: `app/genres/[id]/GenreTimeline.tsx`

**Interfaces:**
- Consumes: `buildGenreTimeline`/`GenreTimelineInput`(Task 3)
- Produces: なし(末端ページ)

- [ ] **Step 1: `app/genres/[id]/GenreTimeline.tsx`を作成**

```tsx
import Link from 'next/link'
import { buildGenreTimeline, type GenreTimelineInput } from '@/utils/genreTimeline'

type ChildGenreRow = {
  id: string
  name: string
  origin_year: number | null
  origin_country: string | null
  origin_city: string | null
}
type HighlightRow = {
  id: number
  genre_id: string
  note: string | null
  artist: { id: string; name: string } | { id: string; name: string }[] | null
  album: { id: string; title: string } | { id: string; title: string }[] | null
}
type ReleaseRow = {
  id: string
  title: string
  release_date: string | null
  artist: { id: string; name: string } | { id: string; name: string }[] | null
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

const KIND_ICON: Record<string, string> = {
  origin: '🌱',
  derived: '↳',
  release: '💿',
  highlight: '⭐',
}

export default function GenreTimeline({
  genreId,
  genreName,
  originYear,
  originCountry,
  originCity,
  children,
  highlights,
  releases,
}: {
  genreId: string
  genreName: string
  originYear: number | null
  originCountry: string | null
  originCity: string | null
  children: ChildGenreRow[]
  highlights: HighlightRow[]
  releases: ReleaseRow[]
}) {
  const input: GenreTimelineInput = {
    genreId,
    genreName,
    originYear,
    originPlace: [originCountry, originCity].filter(Boolean).join(' / ') || null,
    children: children.map((c) => ({
      genreId: c.id,
      genreName: c.name,
      originYear: c.origin_year,
      originPlace: [c.origin_country, c.origin_city].filter(Boolean).join(' / ') || null,
    })),
    highlights: highlights
      .map((h) => {
        const artist = firstOf(h.artist)
        const album = firstOf(h.album)
        if (!artist && !album) return null
        return {
          genreId: h.genre_id,
          artistId: artist?.id ?? null,
          artistName: artist?.name ?? null,
          albumId: album?.id ?? null,
          albumTitle: album?.title ?? null,
          note: h.note,
        }
      })
      .filter((h): h is NonNullable<typeof h> => h !== null),
    releases: releases
      .map((r) => {
        const artist = firstOf(r.artist)
        return artist
          ? { albumId: r.id, albumTitle: r.title, artistName: artist.name, releaseDate: r.release_date }
          : null
      })
      .filter((r): r is NonNullable<typeof r> => r !== null),
  }

  const entries = buildGenreTimeline(input)

  if (entries.length === 0) {
    return <p className="mt-4 text-sm text-white/40">まだ年表に表示できる出来事が登録されていません。</p>
  }

  return (
    <ul className="mt-4 space-y-3 border-l border-white/10 pl-4 text-sm">
      {entries.map((entry, i) => {
        const year = entry.date.slice(0, 4)
        const prevYear = i > 0 ? entries[i - 1].date.slice(0, 4) : null
        return (
          <li key={i} className={entry.indent ? 'ml-4' : undefined}>
            {year !== prevYear && <p className="-ml-4 mb-1 text-xs font-semibold text-white/40">{year}</p>}
            <div className="relative">
              <span className="absolute -left-[21px] top-0.5 text-xs">{KIND_ICON[entry.kind]}</span>
              {entry.href ? (
                <Link href={entry.href} className="text-white/80 hover:text-white">
                  {entry.title}
                </Link>
              ) : (
                <span className="text-white/80">{entry.title}</span>
              )}
              {entry.subtitle && <span className="ml-2 text-xs text-white/40">{entry.subtitle}</span>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
```

- [ ] **Step 2: `app/genres/[id]/page.tsx`を作成**

```tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import GenreTimeline from './GenreTimeline'

export default async function GenreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: genre, error } = await supabase.from('genre').select('*').eq('id', id).single()

  if (error || !genre) {
    notFound()
  }

  const { data: lineageRows } = await supabase
    .from('genre_lineage')
    .select('child:child_genre_id(id, name, origin_year, origin_country, origin_city)')
    .eq('parent_genre_id', id)

  function firstOf<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) return value[0] ?? null
    return value ?? null
  }

  type ChildGenre = { id: string; name: string; origin_year: number | null; origin_country: string | null; origin_city: string | null }
  const children = (lineageRows ?? [])
    .map((r) => firstOf(r.child))
    .filter((c): c is ChildGenre => c !== null)
  const childIds = children.map((c) => c.id)
  const allGenreIds = [id, ...childIds]

  const [{ data: highlights }, { data: artistGenreRows }] = await Promise.all([
    supabase
      .from('genre_highlight')
      .select('id, genre_id, note, artist:artist_id(id, name), album:album_id(id, title)')
      .in('genre_id', allGenreIds),
    supabase.from('artist_genre').select('artist_id').eq('genre_id', id),
  ])

  const artistIds = (artistGenreRows ?? []).map((r) => r.artist_id)
  const { data: releases } = artistIds.length
    ? await supabase
        .from('album')
        .select('id, title, release_date, artist:artist_id(id, name)')
        .in('artist_id', artistIds)
        .order('release_date', { ascending: true, nullsFirst: false })
    : { data: [] }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">{genre.name}</h1>
      <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-white/50">
        {genre.origin_year && <span>発祥 {genre.origin_year}年</span>}
        {(genre.origin_country || genre.origin_city) && (
          <span>{[genre.origin_country, genre.origin_city].filter(Boolean).join(' / ')}</span>
        )}
      </div>
      {genre.wikipedia_url && (
        <a
          href={genre.wikipedia_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://www.google.com/s2/favicons?domain=wikipedia.org&sz=64"
            alt=""
            className="h-3.5 w-3.5"
          />
          Wikipediaで確認 →
        </a>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">年表</h2>
        <GenreTimeline
          genreId={id}
          genreName={genre.name}
          originYear={genre.origin_year}
          originCountry={genre.origin_country}
          originCity={genre.origin_city}
          children={children}
          highlights={highlights ?? []}
          releases={releases ?? []}
        />
      </section>
    </div>
  )
}
```

- [ ] **Step 3: 型チェック・lint**

Run: `npx tsc --noEmit && npx eslint app/genres/`
Expected: エラーなし

- [ ] **Step 4: 開発サーバーで手動確認**

Run: `npm run dev`。Task 6で「Techno」をWikipediaから取り込んだジャンルのidで`/genres/{id}`を開き、発祥年・発祥地・出典リンク・年表(発祥行、代表アーティスト行があれば)が表示されることを確認。`/admin/data/genres`のジャンル一覧の→リンクから遷移できることも確認。

- [ ] **Step 5: コミット**

```bash
git add "app/genres/[id]/page.tsx" "app/genres/[id]/GenreTimeline.tsx"
git commit -m "feat: add public genre detail page with timeline"
```

---

## Note: `app/relations/page.tsx`について

spec (`docs/superpowers/specs/2026-08-21-genre-timeline-design.md`) の「アーキテクチャ」節では`app/relations/page.tsx`のジャンル名テキストを`/genres/{id}`へのリンクに変更する、としていたが、実装時に確認したところジャンル名はcanvas描画される`RelationGraph`コンポーネント内のグループ見出し(`ctx.fillText`相当)としてのみ使われており、DOM上のクリック可能なテキストとしては存在しない。Canvas上のクリック位置判定を新設するのは本プランのスコープを超えるため、このタスクは行わない。ジャンルへの到達経路は「管理画面のジャンル一覧→公開ページ」(Task 6)と、年表内のサブジャンルリンク(Task 3/7)で担保する。
