# アーティスト紹介文(bio)自動生成パイプライン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 選出・表彰を持つ空欄bioのアーティストに対し、Geminiで紹介文を自動生成して即時公開し、事後に取り消せる管理画面を用意する。

**Architecture:** 既存のGemini照合パイプライン(パターンA/B/C)と同じ「Gemini無料枠+リトライ/バックオフ+ログテーブルで追跡」という構成を、生成タスク向けに転用する。ソースは`ranking_article_context`→Wikidata経由Wikipediaのリード文の順で解決し、どちらも無ければスキップする。確信度スコアという概念は使わず、成功(即時公開)/情報不足(スキップ)の2値のみを扱う。

**Tech Stack:** Next.js App Router + Supabase(Postgres/PostgREST) + `@google/genai`(gemini-3.1-flash-lite) + Wikidata/Wikipedia REST API。テストはNode組み込みの`node:test`(`npm test`)。

**Spec:** [docs/superpowers/specs/2026-09-09-artist-bio-generation-design.md](../specs/2026-09-09-artist-bio-generation-design.md)

## Global Constraints

- 対象範囲: `ranking_entry`(直接の`artist_id`、または`album_id`/`track_id`経由)に一件以上登場するアーティストのうち、`bio`が空欄かつ`biography_status !== 'REVERTED'`のもの
- ソース優先順位: (1)`ranking_article_context`の該当アーティスト名のテキスト (2)Wikidataリンク→Wikipedia記事のリード文(ja優先、無ければen) (3)どちらも無ければスキップ
- Geminiモデルは`gemini-3.1-flash-lite`固定。リトライは`MAX_ATTEMPTS=5`、`RETRY_DELAY_MS=3_000`の指数バックオフ(既存の`utils/geminiRadioPickMatch.ts`と同一の値)
- 目標文字数は日本語150〜200字程度。Gemini自身が「情報不足で安全に書けない」と判断した場合は生成せずスキップする
- Geminiには供給した事実・ソーステキストに書かれていない情報を絶対に追加させない(ハルシネーション対策が最優先)
- 生成成功は即時に`artist.bio`へ反映・`biography_status='GENERATED'`として公開する。DBの再検証は`utils/safeRevalidate.ts`の`safeRevalidatePath`を使う(CLIスクリプトからの直接呼び出しでも例外にならないようにするため)
- 取消時は`artist.bio`を元の値に戻し`biography_status='REVERTED'`とする。以後のバッチはこのアーティストを対象から除外する
- `bio_generation_log`は`status`が`'applied'`/`'reverted'`のみを持つ(スキップ・エラーはログに残さず、次回実行時に自然に再挑戦させる。空欄bio+`biography_status`チェックだけで十分に冪等なため)

---

### Task 1: `bio_generation_log`テーブルの作成

**Files:**
- Create: `supabase/migrations/20260909_create_bio_generation_log.sql`

**Interfaces:**
- Produces: テーブル`bio_generation_log`(列: `id`, `artist_id`, `artist_name`, `source_type`, `source_excerpt`, `previous_bio`, `generated_bio`, `status`, `created_at`, `reverted_at`)。Task 5・Task 6から参照される。

- [ ] **Step 1: マイグレーションファイルを作成**

```sql
-- supabase/migrations/20260909_create_bio_generation_log.sql
--
-- アーティスト紹介文(bio)のGemini自動生成ログ。生成のたびに旧文/新文を記録し、
-- 管理画面から取り消せるようにする(radio_pick_match_log等と同じ監査ログの形)。
-- スキップ(ソース無し/Geminiが情報不足と判断)・エラーはここに記録しない。
-- 空欄bio+biography_statusの状態だけで次回実行時に自然に再挑戦できるため、
-- 恒久的な記録が必要なのはappliedとその取消(reverted)だけで十分。
CREATE TABLE bio_generation_log (
  id TEXT PRIMARY KEY DEFAULT generate_ms_id('BGL'::text),
  artist_id TEXT NOT NULL REFERENCES artist(id),
  artist_name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('article_context', 'wikidata')),
  source_excerpt TEXT NOT NULL,
  previous_bio TEXT,
  generated_bio TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied', 'reverted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reverted_at TIMESTAMPTZ
);

CREATE INDEX idx_bio_generation_log_artist ON bio_generation_log (artist_id);
CREATE INDEX idx_bio_generation_log_status ON bio_generation_log (status);

ALTER TABLE bio_generation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON bio_generation_log
  FOR SELECT USING (true);
```

- [ ] **Step 2: マイグレーションを適用**

Run: `npx supabase db push`(またはプロジェクトの既存のマイグレーション適用手順に従う。他のマイグレーションと同じ手順を`git log --oneline -- supabase/migrations | head`等で確認して合わせること)

Expected: `bio_generation_log`テーブルが作成される。

- [ ] **Step 3: テーブルが作成されたことを確認**

Run:
```bash
npx tsx --env-file=.env.local -e "
import { createClient } from '@supabase/supabase-js'
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
s.from('bio_generation_log').select('*').limit(1).then(r => console.log(r))
"
```
Expected: `{ data: [], error: null }` (エラーが出ないこと)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260909_create_bio_generation_log.sql
git commit -m "feat: add bio_generation_log table for artist bio auto-generation"
```

---

### Task 2: Wikipediaリード文の取得・平文化(`utils/wikipediaArticle.ts`)

**Files:**
- Modify: `utils/wikipediaGenre.ts`(内部関数`fetchWikitext`を`export`する。ロジック変更は無し)
- Create: `utils/wikipediaArticle.ts`
- Test: `__tests__/wikipedia-article.unit.test.ts`(pure関数`stripWikitextMarkup`)
- Test: `__tests__/wikipedia-article.integration.test.ts`(実際のWikipedia APIを叩く)

**Interfaces:**
- Consumes: `utils/wikipediaGenre.ts`の`fetchWikitext(lang: 'ja'|'en', title: string): Promise<{ wikitext: string; resolvedTitle: string } | null>`(既存、`export`化するだけ)
- Produces: `stripWikitextMarkup(wikitext: string): string`、`fetchWikipediaLeadText(lang: 'ja'|'en', title: string): Promise<string | null>`。Task 5から使われる。

- [ ] **Step 1: `fetchWikitext`を`export`する**

`utils/wikipediaGenre.ts`の29行目付近:

```ts
// 変更前
async function fetchWikitext(
```
を
```ts
// 変更後
export async function fetchWikitext(
```
に変更する。他の変更は無し。

- [ ] **Step 2: ユニットテストを書く(失敗する状態)**

```ts
// __tests__/wikipedia-article.unit.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { stripWikitextMarkup } from '../utils/wikipediaArticle.ts'

describe('stripWikitextMarkup', () => {
  test('resolves bare wikilinks to their target text', () => {
    const input = '[[藤井風]]は[[岡山県]][[里庄町]]出身の[[シンガーソングライター]]。'
    assert.equal(stripWikitextMarkup(input), '藤井風は岡山県里庄町出身のシンガーソングライター。')
  })

  test('resolves piped links using the display half', () => {
    const input = '[[Wikipedia:表記ガイド|表記ガイド]]に従う。'
    assert.equal(stripWikitextMarkup(input), '表記ガイドに従う。')
  })

  test('removes bold and italic markup', () => {
    const input = "これは'''重要'''で、こちらは''強調''です。"
    assert.equal(stripWikitextMarkup(input), 'これは重要で、こちらは強調です。')
  })

  test('removes ref tags including their content', () => {
    const input = '2020年にデビュー<ref>出典情報</ref>した。'
    assert.equal(stripWikitextMarkup(input), '2020年にデビューした。')
  })

  test('removes self-closing ref tags', () => {
    const input = '2020年にデビュー<ref name="foo" />した。'
    assert.equal(stripWikitextMarkup(input), '2020年にデビューした。')
  })

  test('removes simple non-nested templates', () => {
    const input = '{{lang|en|Kaze Fujii}}は日本のアーティスト。'
    assert.equal(stripWikitextMarkup(input), 'は日本のアーティスト。')
  })

  test('collapses multiple blank lines into one', () => {
    const input = '一行目。\n\n\n二行目。'
    assert.equal(stripWikitextMarkup(input), '一行目。\n二行目。')
  })
})
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npm test -- --test-name-pattern=stripWikitextMarkup`
Expected: FAIL(`../utils/wikipediaArticle.ts`が存在しない)

- [ ] **Step 4: `utils/wikipediaArticle.ts`を実装**

```ts
// utils/wikipediaArticle.ts
//
// アーティスト紹介文(bio)自動生成のためのWikipediaリード文(冒頭セクション)取得。
// wikitext取得自体はutils/wikipediaGenre.tsのfetchWikitext(冒頭セクションのみを
// action=parse&prop=wikitext&section=0で取得する仕組み)をそのまま再利用し、
// ここではGeminiに渡すための平文化だけを担当する。
//
// wikipediaGenre.tsのfindMatchingClose相当のネスト対応はここでは行わない
// (テンプレートが入れ子でも、生成プロンプトの参考テキストとしては多少の
// 取りこぼしが許容範囲。Geminiには供給テキストに無い情報を書き加えないよう
// 別途指示するため、整形漏れが事実の誤りには直結しない)。
import { fetchWikitext } from './wikipediaGenre'

export function stripWikitextMarkup(wikitext: string): string {
  return wikitext
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]|]+)\]\]/g, '$1')
    .replace(/'''''([^']+)'''''/g, '$1')
    .replace(/'''([^']+)'''/g, '$1')
    .replace(/''([^']+)''/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

export async function fetchWikipediaLeadText(lang: 'ja' | 'en', title: string): Promise<string | null> {
  const fetched = await fetchWikitext(lang, title)
  if (!fetched) return null
  const cleaned = stripWikitextMarkup(fetched.wikitext)
  return cleaned.length > 0 ? cleaned : null
}
```

- [ ] **Step 5: ユニットテストを実行して通ることを確認**

Run: `npm test -- --test-name-pattern=stripWikitextMarkup`
Expected: PASS(7件全て)

- [ ] **Step 6: 結合テストを書く**

```ts
// __tests__/wikipedia-article.integration.test.ts
//
// 実際にWikipedia APIを叩く結合テスト(モックしない、既存の結合テストと同じ方針)。
//
// 実行: npm test
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { fetchWikipediaLeadText } from '../utils/wikipediaArticle.ts'

describe('fetchWikipediaLeadText', () => {
  test('fetches a plain-text lead section for a known Japanese article (藤井風)', async () => {
    const text = await fetchWikipediaLeadText('ja', '藤井風')
    assert.ok(text, 'expected lead text')
    assert.ok(!text!.includes('[['), 'should not contain leftover wikilink brackets')
    assert.ok(text!.length > 30)
  })

  test('returns null for a nonexistent article', async () => {
    const text = await fetchWikipediaLeadText('ja', 'zzzznonexistentarticlexyz123')
    assert.equal(text, null)
  })
})
```

- [ ] **Step 7: 結合テストを実行して通ることを確認**

Run: `npm test -- --test-name-pattern=fetchWikipediaLeadText`
Expected: PASS(2件)

- [ ] **Step 8: Commit**

```bash
git add utils/wikipediaGenre.ts utils/wikipediaArticle.ts __tests__/wikipedia-article.unit.test.ts __tests__/wikipedia-article.integration.test.ts
git commit -m "feat: add Wikipedia lead-text fetching for bio generation"
```

---

### Task 3: Wikidataサイトリンク解決(`utils/wikidata.ts`拡張)

**Files:**
- Modify: `utils/wikidata.ts`(末尾に関数を追加)
- Test: `__tests__/wikidata-sitelink.integration.test.ts`

**Interfaces:**
- Produces: `fetchWikipediaSitelink(qid: string): Promise<{ lang: 'ja' | 'en'; title: string } | null>`。Task 5から使われる。

- [ ] **Step 1: 結合テストを書く(失敗する状態)**

QIDは藤井風のもの(`artist_external_link`に実際に登録されている`https://www.wikidata.org/wiki/Q84803821`から。ja/en両方のsitelinkがあることをWikidata APIで確認済み)。

```ts
// __tests__/wikidata-sitelink.integration.test.ts
//
// 実際にWikidata APIを叩く結合テスト(モックしない、既存の結合テストと同じ方針)。
//
// 実行: npm test
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { fetchWikipediaSitelink } from '../utils/wikidata.ts'

describe('fetchWikipediaSitelink', () => {
  test('resolves the Japanese Wikipedia title for 藤井風 (Q84803821)', async () => {
    const result = await fetchWikipediaSitelink('Q84803821')
    assert.ok(result)
    assert.equal(result!.lang, 'ja')
    assert.equal(result!.title, '藤井風')
  })

  test('returns null for a malformed QID', async () => {
    const result = await fetchWikipediaSitelink('not-a-qid')
    assert.equal(result, null)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- --test-name-pattern=fetchWikipediaSitelink`
Expected: FAIL(`fetchWikipediaSitelink`が存在しない)

- [ ] **Step 3: `utils/wikidata.ts`に関数を追加**

ファイル末尾(118行目、`fetchImageUrl`の後)に追加:

```ts
export type WikipediaSitelink = { lang: 'ja' | 'en'; title: string }

/**
 * Wikidataのsitelinksから、日本語版を優先しWikipedia記事タイトルを解決する。
 * jawikiが無ければenwikiにフォールバックする(アーティスト紹介文生成において、
 * 邦楽アーティストはja版、洋楽アーティストはen版が充実している想定)。
 * どちらも無ければnull。
 */
export async function fetchWikipediaSitelink(qid: string): Promise<WikipediaSitelink | null> {
  if (!/^Q\d+$/.test(qid)) return null
  await sleep(300)
  const url = `${WIKIDATA_API_BASE}?action=wbgetentities&ids=${qid}&props=sitelinks&format=json`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) {
    throw new Error(`Wikidata API error (sitelinks): ${res.status}`)
  }
  const data = await res.json()
  const sitelinks = data.entities?.[qid]?.sitelinks
  if (!sitelinks) return null
  if (sitelinks.jawiki?.title) return { lang: 'ja', title: sitelinks.jawiki.title }
  if (sitelinks.enwiki?.title) return { lang: 'en', title: sitelinks.enwiki.title }
  return null
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `npm test -- --test-name-pattern=fetchWikipediaSitelink`
Expected: PASS(2件)

- [ ] **Step 5: Commit**

```bash
git add utils/wikidata.ts __tests__/wikidata-sitelink.integration.test.ts
git commit -m "feat: resolve Wikipedia sitelinks from Wikidata QIDs"
```

---

### Task 4: Gemini紹介文生成(`utils/geminiBioGenerate.ts`)

**Files:**
- Create: `utils/geminiBioGenerate.ts`
- Test: `__tests__/gemini-bio-generate.unit.test.ts`(pure関数`parseGeminiBioResponse`)
- Test: `__tests__/gemini-bio-generate.integration.test.ts`(実際のGemini APIを叩く)

**Interfaces:**
- Produces: `BioGenerationFacts`型、`BioGenerationResult`型、`parseGeminiBioResponse(text: string): BioGenerationResult`、`generateArtistBioWithGemini(facts: BioGenerationFacts, sourceText: string, sourceType: 'article_context' | 'wikidata'): Promise<BioGenerationResult>`。Task 5から使われる。

- [ ] **Step 1: ユニットテストを書く(失敗する状態)**

```ts
// __tests__/gemini-bio-generate.unit.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseGeminiBioResponse } from '../utils/geminiBioGenerate.ts'

describe('parseGeminiBioResponse', () => {
  test('parses a GENERATED response with bio text', () => {
    const text = JSON.stringify({ status: 'GENERATED', bio: '岡山県出身のシンガーソングライター。' })
    assert.deepEqual(parseGeminiBioResponse(text), { status: 'generated', bio: '岡山県出身のシンガーソングライター。' })
  })

  test('trims whitespace from bio', () => {
    const text = JSON.stringify({ status: 'GENERATED', bio: '  余白付きの紹介文  ' })
    assert.deepEqual(parseGeminiBioResponse(text), { status: 'generated', bio: '余白付きの紹介文' })
  })

  test('returns declined for INSUFFICIENT status', () => {
    const text = JSON.stringify({ status: 'INSUFFICIENT' })
    assert.deepEqual(parseGeminiBioResponse(text), { status: 'declined' })
  })

  test('returns declined when bio is an empty/whitespace-only string', () => {
    const text = JSON.stringify({ status: 'GENERATED', bio: '   ' })
    assert.deepEqual(parseGeminiBioResponse(text), { status: 'declined' })
  })

  test('returns declined for invalid JSON', () => {
    assert.deepEqual(parseGeminiBioResponse('not json'), { status: 'declined' })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- --test-name-pattern=parseGeminiBioResponse`
Expected: FAIL(`../utils/geminiBioGenerate.ts`が存在しない)

- [ ] **Step 3: `utils/geminiBioGenerate.ts`を実装**

```ts
// utils/geminiBioGenerate.ts
//
// アーティスト紹介文(bio)の自動生成。utils/geminiRadioPickMatch.ts等と同じ
// gemini-3.1-flash-lite + リトライ構成を流用するが、判定(候補から選ぶ)ではなく
// 生成タスクのため確信度スコアという概念は無く、成功/情報不足の2値のみを扱う。
// ハルシネーション対策として、渡した事実・ソーステキストに無い情報を書き加えない
// よう明示的に指示し、情報が薄すぎる場合はGemini自身に"INSUFFICIENT"を返させる。
import { GoogleGenAI, Type } from '@google/genai'

const MODEL = 'gemini-3.1-flash-lite'

export type BioGenerationFacts = {
  artistName: string
  genreNames: string[]
  formedYear: number | null
  originPrefecture: string | null
  hometownCity: string | null
}

export type BioGenerationResult = { status: 'generated'; bio: string } | { status: 'declined' }

// 分量・トーンの実例(藤井風、386字→165字に手動短縮・承認済み)。目標文字数を
// 具体的に示すため、プロンプトにそのまま埋め込む。
const EXAMPLE_BIO =
  '岡山県里庄町出身のシンガーソングライター/ピアニスト。幼少期からピアノに親しみ、YouTubeのカバー動画で注目を集めた。2019年「何なんw」で活動を本格化し、2020年に1stアルバム『HELP EVER HURT NEVER』を発表。卓越した演奏と岡山弁を交えた歌詞、ジャンルを横断するサウンドで国内外から支持を集めている。'

function buildBioPrompt(facts: BioGenerationFacts, sourceText: string, sourceType: 'article_context' | 'wikidata'): string {
  const genreLine = facts.genreNames.length > 0 ? `ジャンル: ${facts.genreNames.join('、')}` : null
  const formedLine = facts.formedYear ? `活動開始/結成年: ${facts.formedYear}年` : null
  const originLine = facts.originPrefecture
    ? `出身: ${facts.originPrefecture}`
    : facts.hometownCity
      ? `出身: ${facts.hometownCity}`
      : null
  const factsBlock =
    [genreLine, formedLine, originLine].filter((line): line is string => line !== null).join('\n') || '(構造化データなし)'
  const sourceLabel = sourceType === 'article_context' ? '編集部が抽出した紹介記事の断片' : 'Wikipediaの冒頭説明'

  return `音楽データベースサイトに掲載する、アーティスト「${facts.artistName}」の紹介文を書いてください。

参考にできる情報は以下の2種類だけです。ここに書かれていない情報を、一般的な知識や推測で補って書き加えることは絶対にしないでください。

【データベース上の既知の事実】
${factsBlock}

【${sourceLabel}】
${sourceText}

執筆ルール:
- 日本語で150〜200字程度(厳密でなくてよいが大きく外れないこと)
- 経歴と特徴を簡潔にまとめる文体。以下は分量・トーンの実例です:
  「${EXAMPLE_BIO}」
- 見出しや箇条書きは使わず、地の文のみ
- 上記の情報だけでは150字に満たない紹介文しか書けない、あるいは経歴の実態が分からない場合は、無理に書かずstatusを"INSUFFICIENT"にしてください

statusが"GENERATED"の場合のみbioに紹介文を入れてください。`
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    status: { type: Type.STRING, enum: ['GENERATED', 'INSUFFICIENT'] },
    bio: { type: Type.STRING, nullable: true },
  },
  required: ['status'],
}

export function parseGeminiBioResponse(text: string): BioGenerationResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { status: 'declined' }
  }
  const p = parsed as { status?: unknown; bio?: unknown }
  if (p.status === 'GENERATED' && typeof p.bio === 'string' && p.bio.trim().length > 0) {
    return { status: 'generated', bio: p.bio.trim() }
  }
  return { status: 'declined' }
}

// gemini-3.1-flash-liteは高負荷時に503(UNAVAILABLE)を頻繁に返す実態が確認できた
// ため、既存のgeminiRadioPickMatch.ts等と同じリトライ回数・指数バックオフにする
const MAX_ATTEMPTS = 5
const RETRY_DELAY_MS = 3_000

function isRetryableStatus(status: unknown): boolean {
  return status === 503 || status === 429
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function generateArtistBioWithGemini(
  facts: BioGenerationFacts,
  sourceText: string,
  sourceType: 'article_context' | 'wikidata'
): Promise<BioGenerationResult> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません。')
  }

  const ai = new GoogleGenAI({ apiKey })
  const prompt = buildBioPrompt(facts, sourceText, sourceType)

  let lastErr: unknown
  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | undefined
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      response = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
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
        await sleep(RETRY_DELAY_MS * attempt)
        continue
      }
      throw err
    }
  }
  if (!response) throw lastErr

  const text = response.text
  if (!text) return { status: 'declined' }
  return parseGeminiBioResponse(text)
}
```

- [ ] **Step 4: ユニットテストを実行して通ることを確認**

Run: `npm test -- --test-name-pattern=parseGeminiBioResponse`
Expected: PASS(5件全て)

- [ ] **Step 5: 結合テストを書く**

```ts
// __tests__/gemini-bio-generate.integration.test.ts
//
// Gemini紹介文生成の結合テスト。実際のAPI呼び出しを行う(モックしない、
// このプロジェクトの既存結合テストと同じ方針)。GEMINI_API_KEYが未設定の
// 環境ではskipする。
//
// 実行: npm test
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { generateArtistBioWithGemini } from '../utils/geminiBioGenerate.ts'

describe('generateArtistBioWithGemini', () => {
  test('generates a bio from a source text with real biographical content', async (t) => {
    if (!process.env.GEMINI_API_KEY) {
      return t.skip('GEMINI_API_KEY not set')
    }
    const facts = {
      artistName: 'テスト太郎',
      genreNames: ['J-Pop'],
      formedYear: 2020,
      originPrefecture: '東京都',
      hometownCity: null,
    }
    const sourceText =
      'テスト太郎は2020年に東京でデビューしたシンガーソングライター。弾き語りのライブ配信で人気を集め、2022年に1stアルバム『始まりの歌』をリリースした。'
    const result = await generateArtistBioWithGemini(facts, sourceText, 'article_context')
    assert.equal(result.status, 'generated')
    if (result.status === 'generated') {
      assert.ok(result.bio.length >= 50, `expected a non-trivial bio, got: ${result.bio}`)
    }
  })

  test('declines when the source text has no real biographical content', async (t) => {
    if (!process.env.GEMINI_API_KEY) {
      return t.skip('GEMINI_API_KEY not set')
    }
    const facts = { artistName: '謎のアーティストXYZ', genreNames: [], formedYear: null, originPrefecture: null, hometownCity: null }
    const result = await generateArtistBioWithGemini(facts, '謎のアーティストXYZ', 'wikidata')
    assert.equal(result.status, 'declined')
  })
})
```

- [ ] **Step 6: 結合テストを実行して通ることを確認**

Run: `npm test -- --test-name-pattern=generateArtistBioWithGemini`
Expected: PASS(2件)

- [ ] **Step 7: Commit**

```bash
git add utils/geminiBioGenerate.ts __tests__/gemini-bio-generate.unit.test.ts __tests__/gemini-bio-generate.integration.test.ts
git commit -m "feat: add Gemini-based artist bio generation"
```

---

### Task 5: バッチ実行スクリプト(`scripts/generate-artist-bios.ts`)

**Files:**
- Create: `scripts/generate-artist-bios.ts`

**Interfaces:**
- Consumes: `fetchAllRows`(`@/utils/fetchAllRows`)、`fetchWikipediaSitelink`(`@/utils/wikidata`)、`fetchWikipediaLeadText`(`@/utils/wikipediaArticle`)、`generateArtistBioWithGemini`・`BioGenerationFacts`(`@/utils/geminiBioGenerate`)、`safeRevalidatePath`(`@/utils/safeRevalidate`)、`createAdminClient`(`@/utils/Supabase/admin`)
- Produces: CLIスクリプト(他タスクから参照されない、Global Constraintsに従って`artist`/`bio_generation_log`を更新する)

- [ ] **Step 1: スクリプトを実装**

```ts
// scripts/generate-artist-bios.ts
//
// 選出・表彰(ranking_entry)を持つアーティストのうち、bioが空欄のものに対して
// Gemini自動生成パイプラインを実行する。優先順位は選出・表彰の件数が多い順。
// ソースはranking_article_context→Wikidata経由Wikipediaのリード文の順で解決し、
// どちらも取得できないアーティストは今回はスキップする
// (docs/superpowers/specs/2026-09-09-artist-bio-generation-design.md参照)。
//
// after()を使う後続処理(MusicBrainzインポート等)が無いため、
// scripts/verify-radio-pick-matches.tsと違いHTTP経由にせず、このスクリプトから
// 直接Supabaseを操作する。revalidatePathのみsafeRevalidatePathで包む。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/generate-artist-bios.ts [--limit=N]
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchAllRows } from '@/utils/fetchAllRows'
import { fetchWikipediaSitelink } from '@/utils/wikidata'
import { fetchWikipediaLeadText } from '@/utils/wikipediaArticle'
import { generateArtistBioWithGemini, type BioGenerationFacts } from '@/utils/geminiBioGenerate'
import { safeRevalidatePath } from '@/utils/safeRevalidate'

type AdminClient = ReturnType<typeof createAdminClient>

const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : undefined

type ArtistRow = {
  id: string
  name: string
  bio: string | null
  biography_status: string | null
  formed_year: number | null
  origin_prefecture: string | null
  hometown_city: string | null
}

type RankingEntryRow = { artist_id: string | null; album_id: string | null; track_id: string | null }

/** 選出・表彰(ranking_entry)を持つアーティストIDを、件数の多い順に並べて返す。
 * ranking_entryはartist_id直付け・album_id経由・track_id経由の3パターンが
 * 混在するため、album/trackのartist_idをまとめて引いてから件数を数える。 */
async function buildPriorityIds(supabase: AdminClient): Promise<string[]> {
  const entries = await fetchAllRows<RankingEntryRow>(supabase, 'ranking_entry', 'artist_id, album_id, track_id', 'id')

  const albumIds = [...new Set(entries.map((r) => r.album_id).filter((v): v is string => v !== null))]
  const albumArtistById = new Map<string, string>()
  for (let i = 0; i < albumIds.length; i += 500) {
    const { data } = await supabase.from('album').select('id, artist_id').in('id', albumIds.slice(i, i + 500))
    for (const row of data ?? []) {
      if (row.artist_id) albumArtistById.set(row.id, row.artist_id)
    }
  }

  const trackIds = [...new Set(entries.map((r) => r.track_id).filter((v): v is string => v !== null))]
  const trackArtistById = new Map<string, string>()
  for (let i = 0; i < trackIds.length; i += 500) {
    const { data } = await supabase.from('track').select('id, artist_id').in('id', trackIds.slice(i, i + 500))
    for (const row of data ?? []) {
      if (row.artist_id) trackArtistById.set(row.id, row.artist_id)
    }
  }

  const countByArtist = new Map<string, number>()
  for (const entry of entries) {
    const artistId =
      entry.artist_id ??
      (entry.album_id ? albumArtistById.get(entry.album_id) : undefined) ??
      (entry.track_id ? trackArtistById.get(entry.track_id) : undefined)
    if (!artistId) continue
    countByArtist.set(artistId, (countByArtist.get(artistId) ?? 0) + 1)
  }

  return [...countByArtist.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

function extractQid(wikidataUrl: string): string | null {
  const match = wikidataUrl.match(/\/wiki\/(Q\d+)/)
  return match ? match[1] : null
}

type SourceResolution = { sourceType: 'article_context' | 'wikidata'; sourceText: string } | null

/** ソース解決: (1)ranking_article_context (2)Wikidataリンク経由Wikipediaリード文
 * (3)どちらも無ければnull(呼び出し側でスキップ扱いにする)。
 * ranking_article_contextは同名で複数行ありうる(複数の元記事に登場)ため、
 * 各行のfrom_location/for_fans_of/key_track/bio_snippetを結合したテキストが
 * 最も長い行を採用する。 */
async function resolveSource(supabase: AdminClient, artist: ArtistRow): Promise<SourceResolution> {
  const { data: contextRows } = await supabase
    .from('ranking_article_context')
    .select('from_location, for_fans_of, key_track, bio_snippet')
    .eq('artist_name', artist.name)

  let bestContextText = ''
  for (const row of contextRows ?? []) {
    const parts: string[] = []
    if (row.from_location) parts.push(`出身地: ${row.from_location}`)
    if (row.for_fans_of) parts.push(`近しいアーティスト: ${row.for_fans_of}`)
    if (row.key_track) parts.push(`代表曲: ${row.key_track}`)
    if (row.bio_snippet) parts.push(`紹介: ${row.bio_snippet}`)
    const combined = parts.join('\n')
    if (combined.length > bestContextText.length) bestContextText = combined
  }
  if (bestContextText) return { sourceType: 'article_context', sourceText: bestContextText }

  const { data: linkRows } = await supabase
    .from('artist_external_link')
    .select('url')
    .eq('artist_id', artist.id)
    .ilike('url', '%wikidata.org%')
  for (const row of linkRows ?? []) {
    const qid = extractQid(row.url)
    if (!qid) continue
    const sitelink = await fetchWikipediaSitelink(qid)
    if (!sitelink) continue
    const leadText = await fetchWikipediaLeadText(sitelink.lang, sitelink.title)
    if (leadText) return { sourceType: 'wikidata', sourceText: leadText }
  }

  return null
}

async function fetchGenreNames(supabase: AdminClient, artistId: string): Promise<string[]> {
  const { data } = await supabase.from('artist_genre').select('genre:genre_id(name)').eq('artist_id', artistId)
  return (data ?? [])
    .map((row) => (row.genre as { name: string } | null)?.name)
    .filter((name): name is string => Boolean(name))
}

type ProcessOutcome = 'applied' | 'skipped' | 'error'

async function processArtist(supabase: AdminClient, artist: ArtistRow): Promise<ProcessOutcome> {
  const source = await resolveSource(supabase, artist)
  if (!source) return 'skipped'

  const genreNames = await fetchGenreNames(supabase, artist.id)
  const facts: BioGenerationFacts = {
    artistName: artist.name,
    genreNames,
    formedYear: artist.formed_year,
    originPrefecture: artist.origin_prefecture,
    hometownCity: artist.hometown_city,
  }

  let result
  try {
    result = await generateArtistBioWithGemini(facts, source.sourceText, source.sourceType)
  } catch (err) {
    console.error(`  Gemini呼び出しに失敗: ${(err as Error).message}`)
    return 'error'
  }

  if (result.status === 'declined') return 'skipped'

  const { error: updateError } = await supabase
    .from('artist')
    .update({ bio: result.bio, biography_status: 'GENERATED' })
    .eq('id', artist.id)
  if (updateError) {
    console.error(`  DB更新に失敗: ${updateError.message}`)
    return 'error'
  }

  await supabase.from('bio_generation_log').insert({
    artist_id: artist.id,
    artist_name: artist.name,
    source_type: source.sourceType,
    source_excerpt: source.sourceText.slice(0, 2000),
    previous_bio: artist.bio,
    generated_bio: result.bio,
    status: 'applied',
  })

  safeRevalidatePath(`/artists/${artist.id}`)
  return 'applied'
}

async function main() {
  const supabase = createAdminClient()

  console.log('優先アーティスト一覧を作成中...')
  const priorityIds = await buildPriorityIds(supabase)

  const artists: ArtistRow[] = []
  for (let i = 0; i < priorityIds.length; i += 500) {
    const { data } = await supabase
      .from('artist')
      .select('id, name, bio, biography_status, formed_year, origin_prefecture, hometown_city')
      .in('id', priorityIds.slice(i, i + 500))
    artists.push(...((data ?? []) as ArtistRow[]))
  }
  const artistById = new Map(artists.map((a) => [a.id, a]))

  const targets = priorityIds
    .map((id) => artistById.get(id))
    .filter(
      (a): a is ArtistRow => !!a && (!a.bio || a.bio.trim().length === 0) && a.biography_status !== 'REVERTED'
    )
  const scoped = LIMIT ? targets.slice(0, LIMIT) : targets

  console.log(`対象: ${scoped.length}件\n`)

  let applied = 0
  let skipped = 0
  let errors = 0

  for (const [index, artist] of scoped.entries()) {
    const status = await processArtist(supabase, artist)
    console.log(`[${index + 1}/${scoped.length}] ${artist.name}: ${status}`)
    if (status === 'applied') applied += 1
    else if (status === 'skipped') skipped += 1
    else errors += 1
  }

  console.log('\n=== 完了 ===')
  console.log(`生成・公開: ${applied}件`)
  console.log(`スキップ(ソース無し/情報不足): ${skipped}件`)
  console.log(`エラー: ${errors}件`)
}

main()
```

- [ ] **Step 2: 少件数で試し打ちする**

Run: `npx tsx --env-file=.env.local scripts/generate-artist-bios.ts --limit=5`
Expected: エラー無く完了し、5件について`applied`/`skipped`のいずれかが表示される。`applied`になったアーティストについては、Supabaseで`artist.bio`が更新され`bio_generation_log`に1行増えていることを目視確認する。

```bash
npx tsx --env-file=.env.local -e "
import { createClient } from '@supabase/supabase-js'
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
s.from('bio_generation_log').select('artist_name, source_type, generated_bio').order('created_at', { ascending: false }).limit(5).then(r => console.log(r.data))
"
```

生成された`generated_bio`が150〜200字程度に収まっており、`source_excerpt`に無い内容を含んでいないことを目視で確認する。おかしければ`git diff`ではなくSupabase側のデータの問題(プロンプト調整)として扱い、Task 4に戻って調整する。

- [ ] **Step 3: Commit**

```bash
git add scripts/generate-artist-bios.ts
git commit -m "feat: add batch script for artist bio generation"
```

---

### Task 6: 管理画面(生成結果の確認・取消)

**Files:**
- Create: `app/admin/data/artists/bio-generation/actions.ts`
- Create: `app/admin/data/artists/bio-generation/BioGenerationList.tsx`
- Create: `app/admin/data/artists/bio-generation/page.tsx`

**Interfaces:**
- Consumes: `createAdminClient`(`@/utils/Supabase/admin`)、`safeRevalidatePath`(`@/utils/safeRevalidate`)、Task 1で作成した`bio_generation_log`テーブル
- Produces: `revertBioGeneration(logId: string): Promise<{ success: boolean; message: string }>`(このタスク内で完結、他タスクからは使われない)

- [ ] **Step 1: サーバーアクションを実装**

```ts
// app/admin/data/artists/bio-generation/actions.ts
'use server'

import { createAdminClient } from '@/utils/Supabase/admin'
import { safeRevalidatePath } from '@/utils/safeRevalidate'

type ActionResult = { success: boolean; message: string }

/** Gemini生成bioを取り消し、元の状態(previous_bio)に戻す。以後このアーティストは
 * バッチ処理の対象から除外される(scripts/generate-artist-bios.tsの
 * biography_status !== 'REVERTED'条件)。 */
export async function revertBioGeneration(logId: string): Promise<ActionResult> {
  const supabase = createAdminClient()

  const { data: log } = await supabase
    .from('bio_generation_log')
    .select('id, artist_id, previous_bio, status')
    .eq('id', logId)
    .maybeSingle()
  if (!log) return { success: false, message: 'ログが見つかりません。' }
  if (log.status === 'reverted') return { success: false, message: '既に取消済みです。' }

  const { error: updateError } = await supabase
    .from('artist')
    .update({ bio: log.previous_bio, biography_status: 'REVERTED' })
    .eq('id', log.artist_id)
  if (updateError) return { success: false, message: `取消に失敗しました: ${updateError.message}` }

  await supabase
    .from('bio_generation_log')
    .update({ status: 'reverted', reverted_at: new Date().toISOString() })
    .eq('id', logId)

  safeRevalidatePath(`/artists/${log.artist_id}`)
  safeRevalidatePath('/admin/data/artists/bio-generation')
  return { success: true, message: '取り消しました。' }
}
```

- [ ] **Step 2: 一覧のクライアントコンポーネントを実装**

既存の`app/admin/data/media/radio-airplay-pick/GeminiRadioPickQueues.tsx`の`GeminiRadioPickAutoAppliedList`と同じ「楽観的にリストから消す+エラーはインライン表示」の形にする。

```tsx
// app/admin/data/artists/bio-generation/BioGenerationList.tsx
'use client'

import { useState, useTransition } from 'react'
import { revertBioGeneration } from './actions'

export type BioGenerationLogRow = {
  id: string
  artistId: string
  artistName: string
  sourceType: 'article_context' | 'wikidata'
  generatedBio: string
  createdAt: string
}

export default function BioGenerationList({ rows }: { rows: BioGenerationLogRow[] }) {
  const [revertedIds, setRevertedIds] = useState<Set<string>>(new Set())
  const [errorById, setErrorById] = useState<Record<string, string>>({})
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const visible = rows.filter((r) => !revertedIds.has(r.id))
  if (visible.length === 0) {
    return <p className="mt-8 text-sm text-white/40">生成済みの紹介文はありません。</p>
  }

  function handleRevert(id: string) {
    setPendingId(id)
    startTransition(async () => {
      const result = await revertBioGeneration(id)
      if (result.success) {
        setRevertedIds((prev) => new Set(prev).add(id))
      } else {
        setErrorById((prev) => ({ ...prev, [id]: result.message }))
      }
      setPendingId(null)
    })
  }

  return (
    <ul className="mt-4 flex flex-col gap-3">
      {visible.map((r) => (
        <li key={r.id} className="rounded-md border border-white/10 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/artists/${r.artistId}`} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
              {r.artistName}
            </a>
            <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] text-white/50">
              {r.sourceType === 'article_context' ? '記事抽出テキスト' : 'Wikipedia'}
            </span>
            <span className="text-[10px] text-white/30">{new Date(r.createdAt).toLocaleString('ja-JP')}</span>
            <button
              type="button"
              onClick={() => handleRevert(r.id)}
              disabled={isPending && pendingId === r.id}
              className="ml-auto shrink-0 rounded border border-red-500/30 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-40"
            >
              {isPending && pendingId === r.id ? '取消中...' : '取り消す'}
            </button>
          </div>
          <p className="mt-2 text-white/70">{r.generatedBio}</p>
          {errorById[r.id] && <p className="mt-1 text-xs text-red-400">{errorById[r.id]}</p>}
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 3: ページを実装**

```tsx
// app/admin/data/artists/bio-generation/page.tsx
import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import BioGenerationList, { type BioGenerationLogRow } from './BioGenerationList'

export default async function BioGenerationPage() {
  const supabase = await createClient()

  const { data } = await supabase
    .from('bio_generation_log')
    .select('id, artist_id, artist_name, source_type, generated_bio, created_at')
    .eq('status', 'applied')
    .order('created_at', { ascending: false })
    .limit(200)

  const rows: BioGenerationLogRow[] = (data ?? []).map((r) => ({
    id: r.id,
    artistId: r.artist_id,
    artistName: r.artist_name,
    sourceType: r.source_type as 'article_context' | 'wikidata',
    generatedBio: r.generated_bio,
    createdAt: r.created_at,
  }))

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">アーティスト紹介文の自動生成結果</h1>
      <p className="mt-2 text-sm text-white/50">
        Geminiで自動生成・即時公開された紹介文の一覧です(直近200件)。内容がおかしければ「取り消す」で元の状態(空欄)に戻せます。
      </p>

      <BioGenerationList rows={rows} />
    </div>
  )
}
```

- [ ] **Step 4: 型チェック・lintを実行**

Run: `npx tsc --noEmit && npx eslint app/admin/data/artists/bio-generation utils/geminiBioGenerate.ts utils/wikipediaArticle.ts utils/wikidata.ts scripts/generate-artist-bios.ts`
Expected: エラー無し

- [ ] **Step 5: 開発サーバーで目視確認**

Run: `npm run dev`(既に起動していれば不要)

`http://localhost:3000/admin/data/artists/bio-generation`(Basic認証が必要な場合は`.env.local`の`BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD`を使う)を開き、Task 5の試し打ちで生成された行が表示されること、「取り消す」を押すと一覧から消え、対象アーティストの`bio`が空欄に戻ることを確認する。

- [ ] **Step 6: Commit**

```bash
git add app/admin/data/artists/bio-generation
git commit -m "feat: add admin review UI for generated artist bios"
```

---

## 自己レビュー結果

- **spec網羅性:** 設計書の各コンポーネント(wikidata拡張、wikipediaArticle、geminiBioGenerate、bio_generation_log、バッチスクリプト、管理画面)すべてにタスクが対応している。データフロー(事実収集→ソース解決→Gemini生成→即時反映→ログ記録)もTask 5の`processArtist`にそのまま実装されている。
- **プレースホルダー:** 無し。全ステップに実際のコード・実行コマンド・期待結果を記載。
- **型の一貫性:** `BioGenerationFacts`/`BioGenerationResult`(Task 4で定義)、`WikipediaSitelink`(Task 3で定義)をTask 5がそのままimportして使用しており、フィールド名・型が一致している。
- **spec からの実装レベルの補足:** `bio_generation_log`の`status`を設計書の4値(`applied`/`skipped_no_source`/`skipped_declined`/`error`)から`applied`/`reverted`の2値に簡略化した(Global Constraints参照)。スキップ・エラーは空欄bio+`biography_status`の状態だけで次回実行時に自然に再挑戦されるため、恒久的なログ行が不要と判断した。設計書のアーキテクチャ・データフロー・非ゴールと矛盾しない実装上の簡略化であり、スコープや公開/取消フローの合意事項には影響しない。
- **`ranking_article_context`のカラム構成:** 設計書執筆時点では未確認だったため、実際のテーブル(`from_location`/`for_fans_of`/`key_track`/`bio_snippet`の4カラム、いずれも単独でnullになりうる)に合わせてTask 5の`resolveSource`を実装した。
