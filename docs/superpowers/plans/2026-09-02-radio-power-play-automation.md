# ラジオ局パワープレイ自動収集 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 65局以上のラジオ局PP(パワープレイ/ヘビーローテーション)ページから、局のサイト構造を問わずGeminiで選曲を自動抽出し、既存の人力確認フロー(`radio_airplay_pick`)へ流し込む仕組みを、毎週自動実行のVercel Cronで動かす。

**Architecture:** `media.power_play_url`列に各局のPPページURLを持たせ、汎用LLM抽出ユーティリティ(`utils/geminiRadioPickExtract.ts`)が任意のURLから選曲候補を取り出す。新設のcronルートが全局を巡回し、今月分の重複を除いた新規候補だけをiTunes候補付きで`radio_airplay_pick`にinsertする。カタログへの本登録は既存の管理画面(`/admin/data/media/radio-airplay-pick`)の人力確認フローに完全に委ねる。

**Tech Stack:** Next.js App Router (Node 24ネイティブTypeScript実行)、Supabase (Postgres)、`@google/genai`(gemini-3.1-flash-lite)、Vercel Cron、Node組み込みテストランナー(`node --test`)。

**Spec:** `docs/superpowers/specs/2026-09-02-radio-power-play-automation-design.md`

## Global Constraints

- 抽出結果の本登録(カタログ反映)は必ず人力確認を経由する。cronルートは`radio_airplay_pick`へのinsertまでしか行わない(既存方針、変更禁止)。
- 1局の取得・抽出失敗が他局の処理を止めてはならない(try/catchで局ごとに独立させる)。
- iTunes検索(`searchTracks`)の403/429検知時は60秒のクールダウンを挟む(`scripts/backfill-radio-pick-itunes-candidates.ts`と同じ方針)。
- 同一局・同一アーティスト・同一曲名の組み合わせは、今月内に既存行があれば再insertしない(重複防止)。
- Node 24のネイティブTypeScript実行を使うテストファイルでは、相対importに拡張子`.ts`を明記し、`@/`エイリアスは使わない(`__tests__/disc-guide-import.integration.test.ts`と同じ規約)。
- サイト全体を保護する`proxy.ts`のBasic認証は、`/api/cron/`配下だけ除外する(Vercel Cronは`Bearer $CRON_SECRET`を送るため、`Basic`以外を拒否する現行のBasic認証を通過できない)。この除外に伴い、cronルート自身の`CRON_SECRET`検証は必須(唯一の防御になるため省略不可)。

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

### Task 5: cronルートと認証除外

**Files:**
- Modify: `proxy.ts`
- Create: `app/api/cron/radio-power-play/route.ts`
- Create: `vercel.json`
- Test: `__tests__/radio-power-play-cron.integration.test.ts`
- Modify: `.env.local`(`CRON_SECRET`を追加)

**Interfaces:**
- Consumes:
  - `extractRadioPicksFromUrl(stationName: string, url: string): Promise<RadioPickCandidate[]>`(Task 3)
  - `findItunesCandidate(artistName: string, trackTitle: string): Promise<ItunesTrackMatch | null>` / `isRateLimitError(err: unknown): boolean`(Task 2)
  - `media.power_play_url`(Task 1・Task 4でシード済み)
- Produces: `GET /api/cron/radio-power-play`(`Authorization: Bearer $CRON_SECRET`必須)。レスポンス形式: `{ stations: number, totalInserted: number, results: { station: string, extracted: number, inserted: number, error?: string }[] }`

- [ ] **Step 1: `.env.local`にCRON_SECRETを追加する**

ランダムな文字列を生成して追記する(値は出力・表示しない):

```bash
echo "CRON_SECRET=$(openssl rand -hex 32)" >> .env.local
```

- [ ] **Step 2: `proxy.ts`の認証除外を実装する**

`proxy.ts`を以下のように変更する:

```ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// サイト全体をBasic認証で保護する。管理画面(/admin以下)はデータを自由に
// 書き換えられる(ログイン機構が無い前提のため)、公開ページも含めて
// サイト全体を非公開にする。
// 例外: /api/cron/配下はVercel Cronからの呼び出し専用で、Vercelは
// Authorization: Bearer $CRON_SECRET を送る(Basic認証ではない)ため、
// このミドルウェアでは素通りさせ、ルート自身のCRON_SECRET検証に委ねる。
export function proxy(request: NextRequest) {
  const authHeader = request.headers.get('authorization')

  if (authHeader?.startsWith('Basic ')) {
    const base64Credentials = authHeader.slice('Basic '.length)
    const [user, password] = Buffer.from(base64Credentials, 'base64').toString('utf-8').split(':')
    if (user === process.env.BASIC_AUTH_USER && password === process.env.BASIC_AUTH_PASSWORD) {
      return NextResponse.next()
    }
  }

  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Music Synapse"' },
  })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/cron/).*)'],
}
```

- [ ] **Step 3: cronルートを実装する**

```ts
// app/api/cron/radio-power-play/route.ts
//
// Vercel Cronから毎週呼ばれ、media.power_play_urlが設定済みの全局について
// パワープレイ/ヘビーローテーションをGeminiで抽出し、今月分の重複を除いた
// 新規候補をradio_airplay_pickへ登録する(カタログへの本登録は行わない。
// 既存の人力確認フロー/admin/data/media/radio-airplay-pickに委ねる)。
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

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

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

- [ ] **Step 4: `vercel.json`を作成する**

```json
{
  "crons": [
    { "path": "/api/cron/radio-power-play", "schedule": "0 21 * * 1" }
  ]
}
```

(UTC月曜21:00 = JST火曜6:00に毎週実行)

- [ ] **Step 5: 結合テストを書く**

`__tests__/radio-power-play-cron.integration.test.ts`:

```ts
// __tests__/radio-power-play-cron.integration.test.ts
//
// ラジオPP自動収集cronルートの結合テスト。実際のGemini/iTunes呼び出しを含む
// (モックしない、このプロジェクトの既存結合テストと同じ方針)。
// 前提: dev server (`npm run dev`) が起動していること。起動していない場合は
// failではなくskipする。CRON_SECRET / GEMINI_API_KEYが.env.localに必要。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3000'

async function isServerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/cron/radio-power-play`, { signal: AbortSignal.timeout(5000) })
    return res.status !== undefined
  } catch {
    return false
  }
}

describe('GET /api/cron/radio-power-play', () => {
  test('rejects requests without the correct CRON_SECRET (and proves Basic auth was bypassed)', async (t) => {
    if (!(await isServerUp())) return t.skip('dev server not running')

    const res = await fetch(`${BASE_URL}/api/cron/radio-power-play`)
    assert.equal(res.status, 401)
    // proxy.tsのBasic認証ブロックなら "Authentication required." というプレーン
    // テキストが返る。JSONで{error:'unauthorized'}が返っていれば、ミドルウェアを
    // 通過してルート自身のCRON_SECRET検証に到達したことが確認できる。
    assert.match(res.headers.get('content-type') ?? '', /application\/json/)
    const body = await res.json()
    assert.equal(body.error, 'unauthorized')
  })

  test('runs the collection for seeded pilot stations with a valid CRON_SECRET', async (t) => {
    if (!(await isServerUp())) return t.skip('dev server not running')
    if (!process.env.CRON_SECRET) return t.skip('CRON_SECRET not set')
    if (!process.env.GEMINI_API_KEY) return t.skip('GEMINI_API_KEY not set')

    const res = await fetch(`${BASE_URL}/api/cron/radio-power-play`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
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
npm test -- __tests__/radio-power-play-cron.integration.test.ts
```

Expected: PASS(2 tests)。1つ目のテストが「Basic認証を通過してルート自身の401に到達した」ことを検証しており、これが`proxy.ts`のmatcher変更が正しく効いていることの証明になる。

- [ ] **Step 7: 型チェックとlint**

Run: `npx tsc --noEmit && npx eslint proxy.ts app/api/cron/radio-power-play/route.ts`
Expected: エラーなし

- [ ] **Step 8: Vercel環境変数に`CRON_SECRET`を設定する**

`.env.local`の`CRON_SECRET`と同じ値を、Vercelプロジェクトの環境変数(Production)に追加する(`npx vercel env add CRON_SECRET production`、値は`.env.local`の値を使い、コミット履歴やチャットには出力しない)。

- [ ] **Step 9: Commit**

```bash
git add proxy.ts "app/api/cron/radio-power-play/route.ts" vercel.json __tests__/radio-power-play-cron.integration.test.ts
git commit -m "feat: add weekly cron route to collect radio power-play picks"
```

`.env.local`はgit管理外(既存の`.gitignore`)のためcommit対象に含めない。

---

## 実装後のフォローアップ(このplanのスコープ外)

- 残り約62局のURL調査(Claudeが個別にWeb検索し、`scripts/backfill-radio-station-urls.ts`の`STATION_URLS`に追記して再実行する。見つかった分から段階的にcronの対象が広がる)
- Vercel Cronの初回実行結果を確認し、抽出精度に問題があればプロンプト(`buildPrompt`)やレスポンススキーマを調整する
- `/admin/data/media/radio-airplay-pick`で新規に増えた候補を人力確認・本登録する(既存フロー、変更なし)
- **過去アーカイブの抽出**: 今回の仕組み(cronによる「現在の選曲」の週次収集)が安定して動くことを確認できたら、過去分を掲載しているアーカイブページを持つ局について、同じ`extractRadioPicksFromUrl`(汎用Gemini抽出)を使って過去月・過去週分もまとめて取り込めるようにする。ただし今回のcronルートは常に「今日の日付」でinsertする実装のため、アーカイブ抽出は別立てのスクリプトとして新設し、ページ上の期間表記(例:「2026年6月」)をGeminiまたは`utils/radioScrape.ts`の`parseJapaneseMonthLabel`/`parseEnglishMonthLabel`と同様のロジックで実際の`picked_date`に変換する必要がある(このplanでは未着手)。
