# ラジオ局パワープレイ自動収集 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 65局以上のラジオ局PP(パワープレイ/ヘビーローテーション)ページから、局のサイト構造を問わずGeminiで選曲を自動抽出し、既存の人力確認フロー(`radio_airplay_pick`)へ流し込む仕組みを、管理画面のボタン1つで実行できるようにする。

**Architecture:** `media.power_play_url`列に各局のPPページURLを持たせ、汎用LLM抽出ユーティリティ(`utils/geminiRadioPickExtract.ts`)が任意のURLから選曲候補を取り出す。新設のAPIルート(管理画面のボタンから呼ばれる)が全局を巡回し、今月分の重複を除いた新規候補だけをiTunes候補付きで`radio_airplay_pick`にinsertする。カタログへの本登録は既存の管理画面(`/admin/data/media/radio-airplay-pick`)の人力確認フローに完全に委ねる。自動実行(cron)は行わない(セキュリティ上の理由でユーザーが却下、Task 5参照)。

**Tech Stack:** Next.js App Router (Node 24ネイティブTypeScript実行)、Supabase (Postgres)、`@google/genai`(gemini-3.1-flash-lite)、Node組み込みテストランナー(`node --test`)。

**Spec:** `docs/superpowers/specs/2026-09-02-radio-power-play-automation-design.md`

## Global Constraints

- 抽出結果の本登録(カタログ反映)は必ず人力確認を経由する。収集APIルートは`radio_airplay_pick`へのinsertまでしか行わない(既存方針、変更禁止)。
- 1局の取得・抽出失敗が他局の処理を止めてはならない(try/catchで局ごとに独立させる)。
- iTunes検索(`searchTracks`)の403/429検知時は60秒のクールダウンを挟む(`scripts/backfill-radio-pick-itunes-candidates.ts`と同じ方針)。
- 同一局・同一アーティスト・同一曲名の組み合わせは、今月内に既存行があれば再insertしない(重複防止。ボタンを何度押しても安全)。
- Node 24のネイティブTypeScript実行を使うテストファイルでは、相対importに拡張子`.ts`を明記し、`@/`エイリアスは使わない(`__tests__/disc-guide-import.integration.test.ts`と同じ規約)。相対importで結ばれた2つの非テストファイルが両方ともテストのimportグラフから到達可能な場合も、同様に`.ts`拡張子が必要(Task 2/3で実証済み、詳細はTask 2/3のセクション参照)。`@/`エイリアスのimportはNext.jsのバンドラ解決のため対象外。
- 自動実行(cron)は行わない。管理画面のボタン(既存のサイト全体Basic認証の内側)から手動で呼ぶAPIルートとして実装する。`proxy.ts`・`vercel.json`は変更しない。

---

### Task 1: `media.power_play_url`列の追加

**Files:**
- Create: `supabase/migrations/20260902_add_media_power_play_url.sql`

**Interfaces:**
- Produces: `media.power_play_url`(text, nullable)列。以降の全タスクがこの列を読み書きする。

- [ ] **Step 1: マイグレーションファイルを作成する**

```sql
-- media.power_play_url: 各局のパワープレイ/ヘビーローテーションページURL。
-- ラジオ局PP自動収集(app/api/cron/radio-power-play)が対象局を判定するために使う。
-- URLが判明した局から scripts/backfill-radio-station-urls.ts で埋めていく
-- (nullのままの局は既存の手動HRPPシート運用にフォールバックする)。
ALTER TABLE media ADD COLUMN power_play_url TEXT;
```

- [ ] **Step 2: マイグレーションを適用する**

`mcp__claude_ai_Supabase__apply_migration`ツールを、`project_id: ftvhglfthbcxhgnoninv`、`name: add_media_power_play_url`、`query`に上記SQLを渡して実行する。

- [ ] **Step 3: 列が追加されたことを確認する**

`mcp__claude_ai_Supabase__execute_sql`ツールで以下を実行し、`power_play_url`が一覧に含まれることを確認する:

```sql
select column_name, data_type, is_nullable from information_schema.columns where table_name='media' order by ordinal_position;
```

Expected: `power_play_url` / `text` / `YES` の行が含まれる。

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260902_add_media_power_play_url.sql
git commit -m "feat: add media.power_play_url column for radio PP automation"
```

---

### Task 2: iTunes候補マッチングの共通化

既存の`scripts/backfill-radio-pick-itunes-candidates.ts`にインラインで書かれている「アーティスト名+曲名でiTunesを検索し上位1件を候補にする」ロジックと、レート制限検知ロジックを`utils/`に切り出し、後続タスクのcronルートからも使えるようにする。

**Files:**
- Create: `utils/radioPickMatching.ts`
- Modify: `scripts/backfill-radio-pick-itunes-candidates.ts`
- Test: `__tests__/radio-pick-matching.unit.test.ts`

**Interfaces:**
- Consumes: `searchTracks(term: string, limit?: number): Promise<ItunesTrackSearchResult[]>`(`utils/itunes.ts`、既存)
- Produces:
  - `export type ItunesTrackMatch = { trackId: number; trackName: string; artistName: string; collectionId: number; collectionName: string; artworkUrl100?: string }`
  - `export async function findItunesCandidate(artistName: string, trackTitle: string): Promise<ItunesTrackMatch | null>`
  - `export function isRateLimitError(err: unknown): boolean`

- [ ] **Step 1: 失敗するユニットテストを書く**

`__tests__/radio-pick-matching.unit.test.ts`:

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { isRateLimitError } from '../utils/radioPickMatching.ts'

describe('isRateLimitError', () => {
  test('detects 403 in error message', () => {
    assert.equal(isRateLimitError(new Error('iTunes fetch failed: 403 Forbidden')), true)
  })

  test('detects 429 in error message', () => {
    assert.equal(isRateLimitError(new Error('too many requests (429)')), true)
  })

  test('returns false for unrelated errors', () => {
    assert.equal(isRateLimitError(new Error('network timeout')), false)
  })

  test('handles non-Error values', () => {
    assert.equal(isRateLimitError('plain string 429'), true)
    assert.equal(isRateLimitError({ weird: 'object' }), false)
  })
})
```

- [ ] **Step 2: テストを実行し、失敗することを確認する**

Run: `npm test -- __tests__/radio-pick-matching.unit.test.ts`
Expected: FAIL(`utils/radioPickMatching.ts`が存在しないためimportエラー)

- [ ] **Step 3: `utils/radioPickMatching.ts`を実装する**

```ts
// utils/radioPickMatching.ts
//
// ラジオ局PP選曲(アーティスト名+曲名)に対するApple Music候補の検索ロジック。
// scripts/backfill-radio-pick-itunes-candidates.ts(手動HRPPシート向け)と
// app/api/cron/radio-power-play(自動収集向け)の両方から使う共通処理。
import { searchTracks } from './itunes'

export type ItunesTrackMatch = {
  trackId: number
  trackName: string
  artistName: string
  collectionId: number
  collectionName: string
  artworkUrl100?: string
}

/** アーティスト名+曲名でApple Musicを検索し、上位1件を候補として返す。
 * 見つからなければnull。誤マッチのリスクがあるため、あくまで「候補」であり
 * 呼び出し側は必ず人力確認を経てからカタログへ反映する。 */
export async function findItunesCandidate(artistName: string, trackTitle: string): Promise<ItunesTrackMatch | null> {
  const results = await searchTracks(`${artistName} ${trackTitle}`, 1)
  return results[0] ?? null
}

// iTunes側の(非公式・undocumentedな)IPレート制限は、fetchItunes内の
// 400ms間隔だけでは足りず、数百件を連続で叩き続けると403/429が数分間
// ブロックされる形で発生することを確認済み(utils/itunes.tsのコメント参照)。
export function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('403') || message.includes('429')
}
```

- [ ] **Step 4: テストを実行し、成功することを確認する**

Run: `npm test -- __tests__/radio-pick-matching.unit.test.ts`
Expected: PASS(4 tests)

- [ ] **Step 5: `scripts/backfill-radio-pick-itunes-candidates.ts`を共通ロジック利用にリファクタする**

`scripts/backfill-radio-pick-itunes-candidates.ts`の以下の部分を置き換える。

置き換え前(ファイル冒頭付近、ローカル定義の`isRateLimitError`と`searchTracks`直接呼び出し):

```ts
import { createAdminClient } from '@/utils/Supabase/admin'
import { searchTracks } from '@/utils/itunes'
import { fetchAllRows } from '@/utils/fetchAllRows'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const RATE_LIMIT_COOLDOWN_MS = 60_000

function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('403') || message.includes('429')
}
```

置き換え後:

```ts
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchAllRows } from '@/utils/fetchAllRows'
import { findItunesCandidate, isRateLimitError } from '@/utils/radioPickMatching'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const RATE_LIMIT_COOLDOWN_MS = 60_000
```

`main()`内のループ、置き換え前:

```ts
    try {
      const results = await searchTracks(`${row.artist_name} ${row.track_title}`, 1)
      const top = results[0]
      if (top) {
```

置き換え後(`findItunesCandidate`を使うよう変更。以降の`top.xxx`参照はそのまま動く):

```ts
    try {
      const top = await findItunesCandidate(row.artist_name!, row.track_title!)
      if (top) {
```

- [ ] **Step 6: 型チェックとlintを実行する**

Run: `npx tsc --noEmit && npx eslint scripts/backfill-radio-pick-itunes-candidates.ts utils/radioPickMatching.ts`
Expected: エラーなし

- [ ] **Step 7: Commit**

```bash
git add utils/radioPickMatching.ts scripts/backfill-radio-pick-itunes-candidates.ts __tests__/radio-pick-matching.unit.test.ts
git commit -m "refactor: extract shared iTunes candidate matching for radio picks"
```

---

### Task 3: Gemini構造化抽出パイプライン

**Files:**
- Create: `utils/geminiRadioPickExtract.ts`
- Test: `__tests__/gemini-radio-pick-extract.unit.test.ts`
- Test: `__tests__/gemini-radio-pick-extract.integration.test.ts`

**Interfaces:**
- Consumes: `stripHtmlToText(html: string, maxLength?: number): string`(`utils/geminiFestivalLineupExtract.ts`、既存export)
- Produces:
  - `export type RadioPickCandidate = { artistName: string; trackTitle: string; campaignName: string | null }`
  - `export function parseRadioPickResponse(text: string): RadioPickCandidate[]`(ネットワーク非依存の純粋関数)
  - `export async function extractRadioPicksFromUrl(stationName: string, url: string): Promise<RadioPickCandidate[]>`

- [ ] **Step 1: 失敗するユニットテストを書く(`parseRadioPickResponse`)**

`__tests__/gemini-radio-pick-extract.unit.test.ts`:

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseRadioPickResponse } from '../utils/geminiRadioPickExtract.ts'

describe('parseRadioPickResponse', () => {
  test('parses a valid JSON array with campaignName', () => {
    const text = JSON.stringify([
      { artistName: 'Official髭男dism', trackTitle: 'Subtitle', campaignName: 'パワープレイ' },
    ])
    const result = parseRadioPickResponse(text)
    assert.deepEqual(result, [
      { artistName: 'Official髭男dism', trackTitle: 'Subtitle', campaignName: 'パワープレイ' },
    ])
  })

  test('defaults campaignName to null when missing', () => {
    const text = JSON.stringify([{ artistName: 'Foo', trackTitle: 'Bar' }])
    const result = parseRadioPickResponse(text)
    assert.deepEqual(result, [{ artistName: 'Foo', trackTitle: 'Bar', campaignName: null }])
  })

  test('drops entries missing required fields', () => {
    const text = JSON.stringify([
      { artistName: 'OnlyArtist' },
      { trackTitle: 'OnlyTrack' },
      { artistName: 'Complete', trackTitle: 'Entry' },
    ])
    const result = parseRadioPickResponse(text)
    assert.deepEqual(result, [{ artistName: 'Complete', trackTitle: 'Entry', campaignName: null }])
  })

  test('trims whitespace', () => {
    const text = JSON.stringify([{ artistName: '  Spacey  ', trackTitle: '  Title  ', campaignName: '  Camp  ' }])
    const result = parseRadioPickResponse(text)
    assert.deepEqual(result, [{ artistName: 'Spacey', trackTitle: 'Title', campaignName: 'Camp' }])
  })

  test('returns empty array for invalid JSON', () => {
    assert.deepEqual(parseRadioPickResponse('not json'), [])
  })

  test('returns empty array for a non-array JSON value', () => {
    assert.deepEqual(parseRadioPickResponse('{"artistName":"x"}'), [])
  })
})
```

- [ ] **Step 2: テストを実行し、失敗することを確認する**

Run: `npm test -- __tests__/gemini-radio-pick-extract.unit.test.ts`
Expected: FAIL(`utils/geminiRadioPickExtract.ts`が存在しない)

- [ ] **Step 3: `utils/geminiRadioPickExtract.ts`を実装する**

```ts
// utils/geminiRadioPickExtract.ts
//
// ラジオ局PP(パワープレイ/ヘビーローテーション)ページから、選曲候補をGeminiで
// 抽出する。utils/geminiFestivalLineupExtract.tsと同じ方針(無料枠内で収まる
// gemini-3.1-flash-lite)。局ごとにサイト構造が異なるため、正規表現ベースの
// 構造化抽出(utils/radioScrape.ts、3局限定パイロット)の対象外の局はこちらを使う。
import { GoogleGenAI, Type } from '@google/genai'
import { stripHtmlToText } from './geminiFestivalLineupExtract'

const MODEL = 'gemini-3.1-flash-lite'
const USER_AGENT = 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'

export type RadioPickCandidate = {
  artistName: string
  trackTitle: string
  campaignName: string | null
}

export async function fetchStationPageHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    throw new Error(`ページ取得に失敗しました (${res.status})`)
  }
  return res.text()
}

function buildPrompt(stationName: string): string {
  return `以下はラジオ局「${stationName}」の公式サイトから抽出したテキストです。
現在放送中のパワープレイ/ヘビーローテーション(局が今月イチ推しとして選定している楽曲)の一覧を抽出してください。

以下のルールに従ってください:
- 実際に選曲として記載されているアーティスト名・曲名のペアのみを抽出する
  (広告、ナビゲーションメニュー、過去の月の選曲、無関係な特集記事は含めない)
- 「パワープレイ」「ヘビーローテーション」など、ページ上で企画名が判別できれば
  campaignNameに入れる(不明ならnull)
- 同じ組み合わせが複数箇所に出てくる場合は1回だけ含める
- 選曲情報が見つからない場合は空の配列を返す`
}

const RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      artistName: { type: Type.STRING },
      trackTitle: { type: Type.STRING },
      campaignName: { type: Type.STRING },
    },
    required: ['artistName', 'trackTitle'],
  },
}

type GeminiEntry = {
  artistName?: unknown
  trackTitle?: unknown
  campaignName?: unknown
}

const MAX_ATTEMPTS = 2
const RETRY_DELAY_MS = 2_000

function isRetryableStatus(status: unknown): boolean {
  return status === 503 || status === 429
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Geminiのレスポンステキスト(JSON文字列)を候補配列にパースする、ネットワーク
 * 呼び出しを含まない純粋関数。 */
export function parseRadioPickResponse(text: string): RadioPickCandidate[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  return (parsed as GeminiEntry[])
    .filter(
      (e) =>
        typeof e?.artistName === 'string' &&
        e.artistName.trim() &&
        typeof e?.trackTitle === 'string' &&
        e.trackTitle.trim()
    )
    .map((e) => ({
      artistName: (e.artistName as string).trim(),
      trackTitle: (e.trackTitle as string).trim(),
      campaignName: typeof e.campaignName === 'string' && e.campaignName.trim() ? e.campaignName.trim() : null,
    }))
}

export async function extractRadioPicksWithGemini(stationName: string, pageText: string): Promise<RadioPickCandidate[]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません。')
  }
  if (!pageText.trim()) return []

  const ai = new GoogleGenAI({ apiKey })

  let lastErr: unknown
  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | undefined
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      response = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: `${buildPrompt(stationName)}\n\n---\n${pageText}` }] }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      })
      break
    } catch (err) {
      lastErr = err
      const status = (err as { status?: unknown })?.status
      if (attempt < MAX_ATTEMPTS && isRetryableStatus(status)) {
        await sleep(RETRY_DELAY_MS)
        continue
      }
      throw err
    }
  }
  if (!response) throw lastErr

  const text = response.text
  if (!text) return []
  return parseRadioPickResponse(text)
}

/** URLからPP選曲候補をまとめて取得する(fetch→テキスト化→Gemini抽出のフルパイプライン)。 */
export async function extractRadioPicksFromUrl(stationName: string, url: string): Promise<RadioPickCandidate[]> {
  const html = await fetchStationPageHtml(url)
  const pageText = stripHtmlToText(html)
  return extractRadioPicksWithGemini(stationName, pageText)
}
```

- [ ] **Step 4: ユニットテストを実行し、成功することを確認する**

Run: `npm test -- __tests__/gemini-radio-pick-extract.unit.test.ts`
Expected: PASS(6 tests)

- [ ] **Step 5: 結合テストを書く(実際のGemini呼び出し・実際の局ページを使う)**

`__tests__/gemini-radio-pick-extract.integration.test.ts`:

```ts
// __tests__/gemini-radio-pick-extract.integration.test.ts
//
// Gemini構造化抽出の結合テスト。実際のAPI呼び出しを行う(モックしない、
// このプロジェクトの既存結合テストと同じ方針)。GEMINI_API_KEYが未設定の
// 環境ではskipする。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { extractRadioPicksFromUrl } from '../utils/geminiRadioPickExtract.ts'

describe('extractRadioPicksFromUrl', () => {
  test('extracts at least one pick from FM福井 Heavy Rotation (known-working pilot page)', async (t) => {
    if (!process.env.GEMINI_API_KEY) {
      return t.skip('GEMINI_API_KEY not set')
    }

    const picks = await extractRadioPicksFromUrl('FM福井', 'https://www.fmfukui.jp/heavyrotation/')
    assert.ok(picks.length > 0, 'expected at least one extracted pick')
    for (const pick of picks) {
      assert.ok(pick.artistName.length > 0)
      assert.ok(pick.trackTitle.length > 0)
    }
  })
})
```

- [ ] **Step 6: 結合テストを実行する**

Run: `npm test -- __tests__/gemini-radio-pick-extract.integration.test.ts`
Expected: PASS(GEMINI_API_KEYが`.env.local`に設定済みであること。実際のページ内容次第で抽出0件の可能性はゼロではないが、FM福井のページは既存パイロット`radioScrape.ts`で継続的に動作実績があるため、通常は1件以上抽出される想定)

- [ ] **Step 7: 型チェックとlint**

Run: `npx tsc --noEmit && npx eslint utils/geminiRadioPickExtract.ts`
Expected: エラーなし

- [ ] **Step 8: Commit**

```bash
git add utils/geminiRadioPickExtract.ts __tests__/gemini-radio-pick-extract.unit.test.ts __tests__/gemini-radio-pick-extract.integration.test.ts
git commit -m "feat: add Gemini-based radio power-play extraction pipeline"
```

---

### Task 4: 局PPページURLの一括登録スクリプト

3局(既存パイロット)のURLはすでに`utils/radioScrape.ts`で使われているものが判明しているため、これを最初のシードデータとして`media.power_play_url`へ登録する。残り約62局分は、この後Claudeが個別にWeb検索して同じマッピングへ追記していく(このタスクではスクリプトの仕組みと3局分の実データを作る。62局分の追記は別途行う)。

**Files:**
- Create: `scripts/backfill-radio-station-urls.ts`

**Interfaces:**
- Consumes: Task 1で追加した`media.power_play_url`列
- Produces: 実行後、`media`テーブルの`J-WAVE` / `FM福井` / `FMノースウェーブ`の3行に`power_play_url`が設定される(Task 5のcronルート結合テストがこのデータに依存する)。

- [ ] **Step 1: スクリプトを実装する**

```ts
// scripts/backfill-radio-station-urls.ts
//
// media.power_play_url を、事前に調査したURLで一括更新する。ラジオ局PP自動収集
// (app/api/cron/radio-power-play)の対象を広げるための一度きりの実行用スクリプト。
// 新しく局のURLが判明するたびに、下記のマッピングに追記して再実行する
// (既存の値を上書きするだけなので、再実行しても安全)。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/backfill-radio-station-urls.ts
import { createAdminClient } from '@/utils/Supabase/admin'

// 局名(mediaテーブルのnameと完全一致させる) → パワープレイ/ヘビーローテーション
// ページのURL。判明した局から追記していく(utils/radioScrape.tsの3局は
// 既に動作実績のあるURLをそのまま転記した)。
const STATION_URLS: Record<string, string> = {
  'J-WAVE': 'https://www.j-wave.co.jp/special/sonartrax/',
  'FM福井': 'https://www.fmfukui.jp/heavyrotation/',
  'FMノースウェーブ': 'https://www.fmnorth.co.jp/megaplay/',
}

async function main() {
  const supabase = createAdminClient()
  let updated = 0
  let notFound = 0

  for (const [stationName, url] of Object.entries(STATION_URLS)) {
    const { data, error } = await supabase
      .from('media')
      .update({ power_play_url: url })
      .eq('name', stationName)
      .select('id')

    if (error) {
      console.error(`❌ ${stationName}: ${error.message}`)
      continue
    }
    if (!data || data.length === 0) {
      console.log(`⚠️ ${stationName}: mediaテーブルに該当局が見つかりませんでした`)
      notFound++
      continue
    }
    console.log(`✅ ${stationName}: ${url}`)
    updated++
  }

  console.log(`\n完了: ${updated}件更新、${notFound}件未発見`)
}

main()
```

- [ ] **Step 2: 実行する**

Run: `npx tsx --env-file=.env.local scripts/backfill-radio-station-urls.ts`
Expected: `完了: 3件更新、0件未発見`(3局とも`media`テーブルに既存レコードがある前提。`notFound`が出た場合は該当局名の表記ゆれを`media.name`の実際の値に合わせて修正する)

- [ ] **Step 3: 反映を確認する**

`mcp__claude_ai_Supabase__execute_sql`ツールで確認:

```sql
select name, power_play_url from media where power_play_url is not null order by name;
```

Expected: J-WAVE・FM福井・FMノースウェーブの3行がそれぞれのURLとともに返る。

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-radio-station-urls.ts
git commit -m "feat: seed power_play_url for the 3 pilot radio stations"
```

---

### Task 5: 手動収集ページ(管理画面ボタン)

**方針変更(2026-09-02)**: 当初はVercel Cronによる自動実行を予定していたが、実装に入る過程で「Cronからのリクエストを通すにはサイト全体のBasic認証(`proxy.ts`)から`/api/cron/`を除外する必要がある」ことが判明し、ユーザーがこれをセキュリティ上の懸念として明確に却下した。加えてVercel本番環境変数への`CRON_SECRET`登録という、このワークツリー外の副作用も避けたい。そのため**自動実行はやめ、管理画面のボタン1つで手動実行する方式**に変更する。管理画面は既にサイト全体のBasic認証の内側にあるため、`proxy.ts`・`vercel.json`には一切手を加えない。既存の管理画面パターン(`app/admin/data/discguides/DiscGuideDriveImport.tsx`)と同じ「クライアントコンポーネントからAPIルートをfetchし、結果をその場に表示する」構成を踏襲する。

**Files:**
- Create: `app/api/admin/radio-power-play-collect/route.ts`
- Create: `app/admin/data/media/radio-power-play-collect/page.tsx`
- Create: `app/admin/data/media/radio-power-play-collect/CollectButton.tsx`
- Modify: `app/admin/adminTools.ts`
- Test: `__tests__/radio-power-play-collect.integration.test.ts`

**Interfaces:**
- Consumes:
  - `extractRadioPicksFromUrl(stationName: string, url: string): Promise<RadioPickCandidate[]>`(Task 3)
  - `findItunesCandidate(artistName: string, trackTitle: string): Promise<ItunesTrackMatch | null>` / `isRateLimitError(err: unknown): boolean`(Task 2)
  - `media.power_play_url`(Task 1・Task 4でシード済み)
- Produces: `POST /api/admin/radio-power-play-collect`(既存のサイト全体Basic認証で保護される。追加の認証チェックは行わない)。レスポンス形式: `{ stations: number, totalInserted: number, results: { station: string, extracted: number, inserted: number, error?: string }[] }`

- [ ] **Step 1: APIルートを実装する**

```ts
// app/api/admin/radio-power-play-collect/route.ts
//
// 管理画面の「今すぐ全局を収集する」ボタンから呼ばれる。media.power_play_urlが
// 設定済みの全局について、パワープレイ/ヘビーローテーションをGeminiで抽出し、
// 今月分の重複を除いた新規候補をradio_airplay_pickへ登録する(カタログへの
// 本登録は行わない。既存の人力確認フロー/admin/data/media/radio-airplay-pickに
// 委ねる)。サイト全体を保護するBasic認証(proxy.ts)の内側にあるため、
// このルート自体に追加の認証チェックは不要。
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/Supabase/admin'
import { extractRadioPicksFromUrl } from '@/utils/geminiRadioPickExtract'
import { findItunesCandidate, isRateLimitError } from '@/utils/radioPickMatching'

export const maxDuration = 300

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function firstDayOfCurrentMonthISO(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

type StationResult = { station: string; extracted: number; inserted: number; error?: string }

export async function POST() {
  const supabase = createAdminClient()

  const { data: stations, error: stationsError } = await supabase
    .from('media')
    .select('name, area, prefecture, power_play_url')
    .eq('media_type', 'radio')
    .not('power_play_url', 'is', null)

  if (stationsError) {
    return NextResponse.json({ error: stationsError.message }, { status: 500 })
  }

  const monthStart = firstDayOfCurrentMonthISO()
  const todayDate = new Date().toISOString().slice(0, 10)
  const results: StationResult[] = []
  let totalInserted = 0

  for (const station of stations ?? []) {
    try {
      const candidates = await extractRadioPicksFromUrl(station.name, station.power_play_url as string)
      let inserted = 0

      for (const candidate of candidates) {
        const { data: existing } = await supabase
          .from('radio_airplay_pick')
          .select('id')
          .eq('station_name', station.name)
          .ilike('artist_name', candidate.artistName)
          .ilike('track_title', candidate.trackTitle)
          .gte('created_at', monthStart)
          .maybeSingle()

        if (existing) continue

        let itunesMatch = null
        try {
          itunesMatch = await findItunesCandidate(candidate.artistName, candidate.trackTitle)
        } catch (err) {
          if (isRateLimitError(err)) {
            await sleep(60_000)
          }
        }

        const { error: insertError } = await supabase.from('radio_airplay_pick').insert({
          region: station.prefecture ?? station.area ?? '不明',
          station_name: station.name,
          campaign_name: candidate.campaignName,
          picked_date: todayDate,
          artist_name: candidate.artistName,
          track_title: candidate.trackTitle,
          candidate_track_id: itunesMatch?.trackId ?? null,
          candidate_track_name: itunesMatch?.trackName ?? null,
          candidate_artist_name: itunesMatch?.artistName ?? null,
          candidate_collection_id: itunesMatch?.collectionId ?? null,
          candidate_collection_name: itunesMatch?.collectionName ?? null,
          candidate_artwork_url: itunesMatch?.artworkUrl100 ?? null,
        })

        if (!insertError) inserted++
      }

      totalInserted += inserted
      results.push({ station: station.name, extracted: candidates.length, inserted })
    } catch (err) {
      results.push({ station: station.name, extracted: 0, inserted: 0, error: (err as Error).message })
    }
  }

  return NextResponse.json({ stations: (stations ?? []).length, totalInserted, results })
}
```

- [ ] **Step 2: 収集ボタンのクライアントコンポーネントを実装する**

```tsx
// app/admin/data/media/radio-power-play-collect/CollectButton.tsx
//
// app/admin/data/discguides/DiscGuideDriveImport.tsxと同じパターン:
// クライアント側からAPIルートをfetchし、結果をその場に表示する
// (サーバーアクションではなくAPIルートにしているのは、このルートを
// __tests__/radio-power-play-collect.integration.test.tsから直接
// HTTPで叩いて検証できるようにするため)。
'use client'

import { useState } from 'react'

type StationResult = { station: string; extracted: number; inserted: number; error?: string }
type CollectResponse = { stations: number; totalInserted: number; results: StationResult[] }

type State =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; data: CollectResponse }
  | { status: 'error'; message: string }

export default function CollectButton() {
  const [state, setState] = useState<State>({ status: 'idle' })

  const handleClick = async () => {
    setState({ status: 'running' })
    try {
      const res = await fetch('/api/admin/radio-power-play-collect', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setState({ status: 'done', data: body })
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message })
    }
  }

  const isBusy = state.status === 'running'

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={handleClick}
        disabled={isBusy}
        className="rounded bg-blue-600 px-4 py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
      >
        {isBusy ? '収集中...(数分かかる場合があります)' : '今すぐ全局を収集する'}
      </button>

      {state.status === 'error' && <p className="mt-2 text-xs text-red-400">エラー: {state.message}</p>}

      {state.status === 'done' && (
        <div className="mt-3 text-xs">
          <p className="text-green-400">
            {state.data.stations}局を処理し、新規{state.data.totalInserted}件を登録しました。
          </p>
          <ul className="mt-2 space-y-1 text-white/50">
            {state.data.results.map((r) => (
              <li key={r.station}>
                {r.station}: 抽出{r.extracted}件 / 新規{r.inserted}件
                {r.error && <span className="text-red-400"> — エラー: {r.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: ページを実装する**

```tsx
// app/admin/data/media/radio-power-play-collect/page.tsx
import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import CollectButton from './CollectButton'

export default async function RadioPowerPlayCollectPage() {
  const supabase = await createClient()
  const { data: stations } = await supabase
    .from('media')
    .select('name, power_play_url')
    .eq('media_type', 'radio')
    .not('power_play_url', 'is', null)
    .order('name')

  return (
    <div className="mx-auto max-w-[900px] px-6 py-12">
      <Link href="/admin/data/media" className="text-xs text-white/40 hover:text-white/70">
        ← メディア&オンエアに戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">ラジオ局PP自動収集</h1>
      <p className="mt-2 text-sm text-white/50">
        URLが登録済みの局について、パワープレイ/ヘビーローテーションをGeminiでまとめて抽出し、
        新規に見つかった選曲を「HRPP 手動マッチング」画面の候補として登録します。ボタンは何度押しても
        安全です(今月内に既に登録済みの選曲は重複登録されません)。
      </p>

      <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-white/30">
        対象局({stations?.length ?? 0}局)
      </p>
      <ul className="mt-2 space-y-1 text-xs text-white/50">
        {(stations ?? []).map((s) => (
          <li key={s.name}>{s.name}</li>
        ))}
        {(stations?.length ?? 0) === 0 && <li>URLが登録済みの局がまだありません。</li>}
      </ul>

      <CollectButton />
    </div>
  )
}
```

- [ ] **Step 4: 管理画面ツール一覧に追加する**

`app/admin/adminTools.ts`の「メディア&オンエア」グループに、`radio-airplay-pick`のエントリの直後へ以下を追加する:

```ts
      {
        href: '/admin/data/media/radio-power-play-collect',
        label: 'ラジオ局PP自動収集',
        description: 'URL登録済みの全局のパワープレイ/ヘビーローテーションをGeminiでまとめて抽出し、候補として登録する。',
      },
```

- [ ] **Step 5: 結合テストを書く**

`__tests__/radio-power-play-collect.integration.test.ts`:

```ts
// __tests__/radio-power-play-collect.integration.test.ts
//
// ラジオPP自動収集APIルートの結合テスト。実際のGemini/iTunes呼び出しを含む
// (モックしない、このプロジェクトの既存結合テストと同じ方針)。
// 前提: dev server (`npm run dev`) が起動していること。起動していない場合は
// failではなくskipする。サイト全体がBasic認証配下にあるためAuthorization
// ヘッダを付ける(__tests__/disc-guide-import.integration.test.tsと同じ
// パターン)。GEMINI_API_KEYが.env.localに必要。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3000'

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const user = process.env.BASIC_AUTH_USER ?? ''
  const pass = process.env.BASIC_AUTH_PASSWORD ?? ''
  const token = Buffer.from(`${user}:${pass}`).toString('base64')
  return { Authorization: `Basic ${token}`, ...extra }
}

async function isServerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/admin/data/media/radio-power-play-collect`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(5000),
    })
    return res.status !== 404
  } catch {
    return false
  }
}

describe('POST /api/admin/radio-power-play-collect', () => {
  test('rejects requests without Basic auth (site-wide proxy.ts still protects this route)', async (t) => {
    if (!(await isServerUp())) return t.skip('dev server not running')

    const res = await fetch(`${BASE_URL}/api/admin/radio-power-play-collect`, { method: 'POST' })
    assert.equal(res.status, 401)
  })

  test('runs the collection for seeded pilot stations with valid Basic auth', async (t) => {
    if (!(await isServerUp())) return t.skip('dev server not running')
    if (!process.env.GEMINI_API_KEY) return t.skip('GEMINI_API_KEY not set')

    const res = await fetch(`${BASE_URL}/api/admin/radio-power-play-collect`, {
      method: 'POST',
      headers: authHeaders(),
    })
    const text = await res.text()
    assert.equal(res.status, 200, text)
    const body = JSON.parse(text)

    assert.ok(body.stations >= 3, `expected at least the 3 seeded pilot stations, got ${body.stations}`)
    const stationNames = body.results.map((r: { station: string }) => r.station)
    assert.ok(stationNames.includes('FM福井'), 'expected FM福井 to be among the processed stations')

    const fmFukui = body.results.find((r: { station: string }) => r.station === 'FM福井')
    assert.equal(fmFukui.error, undefined, `FM福井 extraction should not error: ${fmFukui.error}`)
  })
})
```

- [ ] **Step 6: サーバーを起動してテストを実行する**

```bash
npm run dev &
sleep 3
npm test -- __tests__/radio-power-play-collect.integration.test.ts
```

Expected: PASS(2 tests)。1つ目のテストは、このルートが(何も変更していない)既存のBasic認証で確実に保護され続けていることの確認になる。

- [ ] **Step 7: 型チェックとlint**

Run: `npx tsc --noEmit && npx eslint app/api/admin/radio-power-play-collect/route.ts app/admin/data/media/radio-power-play-collect/page.tsx app/admin/data/media/radio-power-play-collect/CollectButton.tsx app/admin/adminTools.ts`
Expected: エラーなし

- [ ] **Step 8: devサーバーでブラウザ相当の動作確認をする**

`curl`で`/admin/data/media/radio-power-play-collect`にBasic認証付きでアクセスし、対象局一覧とボタンが描画されたHTMLが返ることを確認する:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASSWORD" http://localhost:3000/admin/data/media/radio-power-play-collect
```

Expected: `200`

- [ ] **Step 9: Commit**

```bash
git add app/api/admin/radio-power-play-collect/route.ts app/admin/data/media/radio-power-play-collect/page.tsx app/admin/data/media/radio-power-play-collect/CollectButton.tsx app/admin/adminTools.ts __tests__/radio-power-play-collect.integration.test.ts
git commit -m "feat: add manual admin button to collect radio power-play picks"
```

---

## 実装後のフォローアップ(このplanのスコープ外)

- 残り約62局のURL調査(Claudeが個別にWeb検索し、`scripts/backfill-radio-station-urls.ts`の`STATION_URLS`に追記して再実行する。見つかった分から段階的に収集対象が広がる)
- 初回の収集結果を確認し、抽出精度に問題があればプロンプト(`buildPrompt`)やレスポンススキーマを調整する
- `/admin/data/media/radio-airplay-pick`で新規に増えた候補を人力確認・本登録する(既存フロー、変更なし)
- **過去アーカイブの抽出**: 今回の仕組み(手動収集による「現在の選曲」の収集)が安定して動くことを確認できたら、過去分を掲載しているアーカイブページを持つ局について、同じ`extractRadioPicksFromUrl`(汎用Gemini抽出)を使って過去月・過去週分もまとめて取り込めるようにする。ただし今回の収集APIルートは常に「今日の日付」でinsertする実装のため、アーカイブ抽出は別立てのスクリプトとして新設し、ページ上の期間表記(例:「2026年6月」)をGeminiまたは`utils/radioScrape.ts`の`parseJapaneseMonthLabel`/`parseEnglishMonthLabel`と同様のロジックで実際の`picked_date`に変換する必要がある(このplanでは未着手)。
