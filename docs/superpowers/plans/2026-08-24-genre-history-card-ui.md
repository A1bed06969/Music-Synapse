# ジャンル年表 カード型UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/genres/[id]`(全242ジャンル共通)を、年代ごとの大型カードを横一列に並べたインタラクティブ・タイムライン+下部詳細パネル+ジャンル進化グラフのUIに置き換える。

**Architecture:** `genre_lineage`に`relation_type`列を追加し、ブルースの派生関係を多段階チェーンに再構成する。`utils/genreHistory.ts`にDB行→表示データへの純粋な変換ロジック(再帰的な子孫列挙・ERAカード生成・ジャンル進化ツリー構築)を置き、`app/genres/[id]/page.tsx`はデータ取得のみ行い、`GenreHistoryView`以下のクライアントコンポーネント群が表示・インタラクションを担当する。既存の`GenreTimeline.tsx`/`utils/genreTimeline.ts`は削除する。

**Tech Stack:** Next.js App Router、Tailwind v4(transitionユーティリティのみ、新規ライブラリ追加なし)、Supabase、Node標準テストランナー(`node:test`)。

**Spec:** `docs/superpowers/specs/2026-08-24-genre-history-card-ui-design.md`

## Global Constraints

- 新しいURLパターンは作らない。既存の`/genres/[id]`・`/artists/[id]`・`/albums/[id]`をそのまま使う
- アニメーションライブラリ(Framer Motion等)は追加しない。CSS/Tailwindの`transition`のみで実装する
- ハードコードされたジャンル別データは書かない。表示は全て`genre`/`genre_lineage`/`genre_highlight`/`artist`/`album`テーブル由来にする
- 各ERAカードの代表アーティスト/作品は、そのカードに対応する1ジャンルへの直接紐付け(`genre_highlight.genre_id`が一致する行)のみを使う。子孫ジャンルの`genre_highlight`を合算しない
- 色トークンは`amber, yellow, green, blue, coral, purple`の6色を配列インデックスでローテーションする(ジャンル内容とのハードコード対応付けをしない)
- モバイルはカードを横スクロール(`overflow-x-auto`)にする。縦に積み重ねる設計にはしない

---

### Task 1: `genre_lineage`に`relation_type`列を追加

**Files:**
- Create: `supabase/migrations/20260824_add_genre_lineage_relation_type.sql`

**Interfaces:**
- Produces: `genre_lineage.relation_type`(`TEXT NOT NULL DEFAULT 'derivation'`、値は`'derivation'|'influence'|'crossover'`のいずれか)。以降の全タスクがこの列を参照する

- [ ] **Step 1: マイグレーションファイルを作成**

`supabase/migrations/20260824_add_genre_lineage_relation_type.sql`:

```sql
-- ジャンル進化グラフで「主な派生(実線)」「影響(点線)」「クロスオーバー(破線)」を
-- 区別して表示するための列。既存行(全てderivationの意味合い)はデフォルト値のまま。
ALTER TABLE genre_lineage ADD COLUMN relation_type TEXT NOT NULL DEFAULT 'derivation'
  CHECK (relation_type IN ('derivation', 'influence', 'crossover'));
```

- [ ] **Step 2: Supabase MCPの`apply_migration`で本番DBに適用**

`name`パラメータ: `add_genre_lineage_relation_type`、`query`パラメータはStep 1のSQLそのもの。

- [ ] **Step 3: 適用結果を確認**

`execute_sql`で以下を実行し、列が追加され既存行が`derivation`になっていることを確認する:

```sql
select relation_type, count(*) from genre_lineage group by relation_type;
```

期待結果: 既存の全行(7件前後)が`derivation`で1グループのみ。

- [ ] **Step 4: コミット**

```bash
git add supabase/migrations/20260824_add_genre_lineage_relation_type.sql
git commit -m "feat: add relation_type to genre_lineage for genre evolution graph"
```

---

### Task 2: ブルースの`genre_lineage`を多段階チェーンに再構成

**Files:**
- (コード変更なし。本番DBへの直接SQL適用のみ。Supabase MCPの`execute_sql`を使う)

**Interfaces:**
- Consumes: Task 1の`relation_type`列
- Produces: 以下の`genre_lineage`構造(Task 3以降のテスト・実装がこの構造を前提にする)

```
blues (MS_GNR_2iqbgazg)
 ├─ カントリー・ブルース (MS_GNR_2dtzyxbl) [derivation]
 │   └─ デルタ・ブルース (MS_GNR_inmclr8v) [derivation]
 │       └─ シカゴ・ブルース (MS_GNR_yuyurel1) [derivation]
 │           └─ ブルース・ロック (MS_GNR_9e3vrbb3) [derivation]
 │               ├─ パンク・ブルース (MS_GNR_7kdcxbpw) [derivation]
 │               ├─ hard rock (MS_GNR_yujtye4p) [derivation]
 │               └─ garage rock (MS_GNR_0hd06yg9) [influence]
 ├─ クラシック・フィメール・ブルース (MS_GNR_f2e7058p) [derivation]
 └─ 日本のブルース (MS_GNR_8imk3g41) [derivation]
```

- [ ] **Step 1: 現状のブルース関連`genre_lineage`行を確認**

```sql
select id, parent_genre_id, child_genre_id, relation_type
from genre_lineage
where parent_genre_id in ('MS_GNR_2iqbgazg','MS_GNR_2dtzyxbl','MS_GNR_inmclr8v','MS_GNR_yuyurel1','MS_GNR_9e3vrbb3','MS_GNR_7kdcxbpw')
   or child_genre_id in ('MS_GNR_2dtzyxbl','MS_GNR_inmclr8v','MS_GNR_yuyurel1','MS_GNR_9e3vrbb3','MS_GNR_7kdcxbpw','MS_GNR_8imk3g41','MS_GNR_f2e7058p');
```

既存の直接エッジ(`blues→デルタ・ブルース`、`blues→シカゴ・ブルース`、`blues→ブルース・ロック`、`blues→パンク・ブルース`)のIDを控えておく(次のStepで削除する)。

- [ ] **Step 2: 不要になる直接エッジを削除**

Step 1で確認した「`blues`→デルタ・ブルース/シカゴ・ブルース/ブルース・ロック/パンク・ブルース」の4行だけを`id`指定で削除する(`blues`→カントリー・ブルース、`blues`→クラシック・フィメール・ブルース、`blues`→日本のブルースの3行は残す):

```sql
DELETE FROM genre_lineage
WHERE parent_genre_id = 'MS_GNR_2iqbgazg'
  AND child_genre_id IN ('MS_GNR_inmclr8v', 'MS_GNR_yuyurel1', 'MS_GNR_9e3vrbb3', 'MS_GNR_7kdcxbpw');
```

- [ ] **Step 3: 多段階チェーンの新しいエッジを追加**

```sql
INSERT INTO genre_lineage (parent_genre_id, child_genre_id, relation_type) VALUES
('MS_GNR_2dtzyxbl', 'MS_GNR_inmclr8v', 'derivation'), -- カントリー・ブルース → デルタ・ブルース
('MS_GNR_inmclr8v', 'MS_GNR_yuyurel1', 'derivation'), -- デルタ・ブルース → シカゴ・ブルース
('MS_GNR_yuyurel1', 'MS_GNR_9e3vrbb3', 'derivation'), -- シカゴ・ブルース → ブルース・ロック
('MS_GNR_9e3vrbb3', 'MS_GNR_7kdcxbpw', 'derivation'), -- ブルース・ロック → パンク・ブルース
('MS_GNR_9e3vrbb3', 'MS_GNR_yujtye4p', 'derivation'), -- ブルース・ロック → hard rock
('MS_GNR_9e3vrbb3', 'MS_GNR_0hd06yg9', 'influence')   -- ブルース・ロック → garage rock(影響)
RETURNING parent_genre_id, child_genre_id, relation_type;
```

- [ ] **Step 4: 結果を確認**

```sql
select g1.name as parent, g2.name as child, gl.relation_type
from genre_lineage gl
join genre g1 on g1.id = gl.parent_genre_id
join genre g2 on g2.id = gl.child_genre_id
where gl.parent_genre_id in ('MS_GNR_2iqbgazg','MS_GNR_2dtzyxbl','MS_GNR_inmclr8v','MS_GNR_yuyurel1','MS_GNR_9e3vrbb3')
order by parent;
```

期待結果: Task 2冒頭のツリー図と一致する9行(blues→3件、カントリー→デルタ、デルタ→シカゴ、シカゴ→ブルースロック、ブルースロック→パンク/hard rock/garage rockの6件、合計9件)。

- [ ] **Step 5: コミット**

このタスクはコード変更が無いため、次のタスクのコミットに含める(単独コミット不要)。

---

### Task 3: `utils/genreHistory.ts` — 子孫列挙・ERAカード生成ロジック(TDD)

**Files:**
- Create: `utils/genreHistory.ts`
- Test: `__tests__/genre-history.unit.test.ts`

**Interfaces:**
- Produces:
  - `type LineageEdge = { parentGenreId: string; childGenreId: string; relationType: 'derivation' | 'influence' | 'crossover' }`
  - `type GenreRow = { id: string; name: string; originYear: number | null; originYearLabel: string | null; originCountry: string | null; backgroundNote: string | null }`
  - `type HighlightRow = { genreId: string; artistId: string | null; artistName: string | null; artistImageUrl: string | null; albumId: string | null; albumTitle: string | null; albumJacketUrl: string | null; eventYear: number | null; eventYearLabel: string | null; note: string | null }`
  - `type EraColorToken = 'amber' | 'yellow' | 'green' | 'blue' | 'coral' | 'purple'`
  - `type EraCardData = { genreId: string; period: string; title: string; region: string | null; colorToken: EraColorToken; description: string | null; representativeArtists: { id: string; name: string; imageUrl: string | null }[]; representativeWorks: { id: string; title: string; year: number | null; artistName: string | null }[]; imageUrl: string | null }`
  - `getDescendantGenreIds(rootId: string, edges: LineageEdge[]): string[]`
  - `buildEraCards(rootId: string, genres: GenreRow[], edges: LineageEdge[], highlights: HighlightRow[]): EraCardData[]`
- Consumes: Task 4はこのファイルに追記する形で`buildGenreEvolutionTree`を追加する(同じ`LineageEdge`/`GenreRow`型を再利用)

- [ ] **Step 1: テストディレクトリのimportパスを確認**

既存の`__tests__/genre-timeline.unit.test.ts`と同じ相対import方式(`from '../utils/genreHistory.ts'`)を使う。

- [ ] **Step 2: 失敗するテストを書く**

`__tests__/genre-history.unit.test.ts`:

```ts
// __tests__/genre-history.unit.test.ts
//
// ジャンル年表(カード型UI)のコアロジックのユニットテスト。DB/サーバ不要、純粋関数のみ。
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getDescendantGenreIds, buildEraCards, type GenreRow, type LineageEdge, type HighlightRow } from '../utils/genreHistory.ts'

describe('getDescendantGenreIds', () => {
  test('a simple chain returns root + all descendants in BFS order', () => {
    const edges: LineageEdge[] = [
      { parentGenreId: 'A', childGenreId: 'B', relationType: 'derivation' },
      { parentGenreId: 'B', childGenreId: 'C', relationType: 'derivation' },
    ]
    assert.deepEqual(getDescendantGenreIds('A', edges), ['A', 'B', 'C'])
  })

  test('branching returns all branches', () => {
    const edges: LineageEdge[] = [
      { parentGenreId: 'A', childGenreId: 'B', relationType: 'derivation' },
      { parentGenreId: 'A', childGenreId: 'C', relationType: 'derivation' },
    ]
    assert.deepEqual(getDescendantGenreIds('A', edges), ['A', 'B', 'C'])
  })

  test('a genre with no children returns only itself', () => {
    const edges: LineageEdge[] = [{ parentGenreId: 'X', childGenreId: 'Y', relationType: 'derivation' }]
    assert.deepEqual(getDescendantGenreIds('A', edges), ['A'])
  })

  test('does not infinite-loop on a cycle (defensive)', () => {
    const edges: LineageEdge[] = [
      { parentGenreId: 'A', childGenreId: 'B', relationType: 'derivation' },
      { parentGenreId: 'B', childGenreId: 'A', relationType: 'derivation' },
    ]
    assert.deepEqual(getDescendantGenreIds('A', edges), ['A', 'B'])
  })
})

function genre(overrides: Partial<GenreRow> & { id: string }): GenreRow {
  return {
    name: overrides.id,
    originYear: null,
    originYearLabel: null,
    originCountry: null,
    backgroundNote: null,
    ...overrides,
  }
}

describe('buildEraCards', () => {
  test('cards are ordered by originYear ascending across a multi-level tree', () => {
    const genres: GenreRow[] = [
      genre({ id: 'blues', name: 'Blues', originYear: 1875 }),
      genre({ id: 'country', name: 'Country Blues', originYear: 1920 }),
      genre({ id: 'delta', name: 'Delta Blues', originYear: 1920 }),
      genre({ id: 'chicago', name: 'Chicago Blues', originYear: 1950 }),
    ]
    const edges: LineageEdge[] = [
      { parentGenreId: 'blues', childGenreId: 'country', relationType: 'derivation' },
      { parentGenreId: 'country', childGenreId: 'delta', relationType: 'derivation' },
      { parentGenreId: 'delta', childGenreId: 'chicago', relationType: 'derivation' },
    ]
    const cards = buildEraCards('blues', genres, edges, [])
    assert.deepEqual(
      cards.map((c) => c.genreId),
      ['blues', 'country', 'delta', 'chicago']
    )
  })

  test('a highlight only appears on the card of its own genre, not on ancestor cards', () => {
    const genres: GenreRow[] = [
      genre({ id: 'chicago', name: 'Chicago Blues', originYear: 1950 }),
      genre({ id: 'bluesrock', name: 'Blues Rock', originYear: 1960 }),
    ]
    const edges: LineageEdge[] = [{ parentGenreId: 'chicago', childGenreId: 'bluesrock', relationType: 'derivation' }]
    const highlights: HighlightRow[] = [
      {
        genreId: 'bluesrock',
        artistId: 'a1',
        artistName: 'The Rolling Stones',
        artistImageUrl: null,
        albumId: null,
        albumTitle: null,
        albumJacketUrl: null,
        eventYear: null,
        eventYearLabel: null,
        note: null,
      },
    ]
    const cards = buildEraCards('chicago', genres, edges, highlights)
    const chicagoCard = cards.find((c) => c.genreId === 'chicago')!
    const bluesRockCard = cards.find((c) => c.genreId === 'bluesrock')!
    assert.deepEqual(chicagoCard.representativeArtists, [])
    assert.equal(bluesRockCard.representativeArtists.length, 1)
    assert.equal(bluesRockCard.representativeArtists[0].name, 'The Rolling Stones')
  })

  test('color rotates through the 6 tokens and wraps around for a 7th card', () => {
    const ids = ['g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6']
    const genres: GenreRow[] = ids.map((id, i) => genre({ id, originYear: 1900 + i }))
    // g0はroot、残り6件は直列の子(depthは問わずoriginYear順に並べばよい)
    const edges: LineageEdge[] = []
    for (let i = 0; i < ids.length - 1; i++) {
      edges.push({ parentGenreId: ids[i], childGenreId: ids[i + 1], relationType: 'derivation' })
    }
    const cards = buildEraCards('g0', genres, edges, [])
    assert.deepEqual(
      cards.map((c) => c.colorToken),
      ['amber', 'yellow', 'green', 'blue', 'coral', 'purple', 'amber']
    )
  })

  test('a descendant genre with no originYear is excluded from the cards', () => {
    const genres: GenreRow[] = [
      genre({ id: 'blues', originYear: 1875 }),
      genre({ id: 'unknown', originYear: null }),
    ]
    const edges: LineageEdge[] = [{ parentGenreId: 'blues', childGenreId: 'unknown', relationType: 'derivation' }]
    const cards = buildEraCards('blues', genres, edges, [])
    assert.deepEqual(
      cards.map((c) => c.genreId),
      ['blues']
    )
  })

  test('representativeWorks and representativeArtists are empty when there are no highlights', () => {
    const genres: GenreRow[] = [genre({ id: 'blues', originYear: 1875 })]
    const cards = buildEraCards('blues', genres, [], [])
    assert.deepEqual(cards[0].representativeArtists, [])
    assert.deepEqual(cards[0].representativeWorks, [])
  })

  test('imageUrl prefers an artist image, falling back to an album jacket', () => {
    const genres: GenreRow[] = [genre({ id: 'blues', originYear: 1875 })]
    const highlights: HighlightRow[] = [
      {
        genreId: 'blues',
        artistId: 'a1',
        artistName: 'W.C. Handy',
        artistImageUrl: null,
        albumId: 'al1',
        albumTitle: 'St. Louis Blues',
        albumJacketUrl: 'https://example.com/jacket.jpg',
        eventYear: 1914,
        eventYearLabel: null,
        note: null,
      },
    ]
    const cards = buildEraCards('blues', genres, [], highlights)
    assert.equal(cards[0].imageUrl, 'https://example.com/jacket.jpg')
    assert.equal(cards[0].representativeWorks[0].year, 1914)
  })

  test('period label prefers originYearLabel over the raw year', () => {
    const genres: GenreRow[] = [genre({ id: 'blues', originYear: 1875, originYearLabel: '19世紀後半' })]
    const cards = buildEraCards('blues', genres, [], [])
    assert.equal(cards[0].period, '19世紀後半')
  })
})
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npm test`
Expected: `Cannot find module '../utils/genreHistory.ts'` 相当のエラーでFAIL。

- [ ] **Step 4: 実装**

`utils/genreHistory.ts`:

```ts
// utils/genreHistory.ts
//
// ジャンル年表(カード型UI)のコアロジック。DB行(genre/genre_lineage/genre_highlight)を
// カード表示用のデータへ変換する純粋関数群。app/genres/[id]/page.tsxはこのファイルの
// 関数にデータを渡すだけで、ロジック自体はここに閉じ込める(テスト容易性のため)。

export type LineageEdge = {
  parentGenreId: string
  childGenreId: string
  relationType: 'derivation' | 'influence' | 'crossover'
}

export type GenreRow = {
  id: string
  name: string
  originYear: number | null
  originYearLabel: string | null
  originCountry: string | null
  backgroundNote: string | null
}

export type HighlightRow = {
  genreId: string
  artistId: string | null
  artistName: string | null
  artistImageUrl: string | null
  albumId: string | null
  albumTitle: string | null
  albumJacketUrl: string | null
  eventYear: number | null
  eventYearLabel: string | null
  note: string | null
}

export type EraColorToken = 'amber' | 'yellow' | 'green' | 'blue' | 'coral' | 'purple'

const ERA_COLOR_ROTATION: EraColorToken[] = ['amber', 'yellow', 'green', 'blue', 'coral', 'purple']

export type EraCardData = {
  genreId: string
  period: string
  title: string
  region: string | null
  colorToken: EraColorToken
  description: string | null
  representativeArtists: { id: string; name: string; imageUrl: string | null }[]
  representativeWorks: { id: string; title: string; year: number | null; artistName: string | null }[]
  imageUrl: string | null
}

/** rootId自身を含めた、genre_lineageを辿った全子孫のIDをBFS順で返す。
 * 循環参照があっても無限ループしないようseenで防御する。 */
export function getDescendantGenreIds(rootId: string, edges: LineageEdge[]): string[] {
  const childrenByParent = new Map<string, string[]>()
  for (const edge of edges) {
    const list = childrenByParent.get(edge.parentGenreId) ?? []
    list.push(edge.childGenreId)
    childrenByParent.set(edge.parentGenreId, list)
  }

  const result: string[] = [rootId]
  const seen = new Set<string>([rootId])
  const queue: string[] = [rootId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const child of childrenByParent.get(current) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      result.push(child)
      queue.push(child)
    }
  }
  return result
}

/** rootIdジャンル自身+その全子孫(再帰的)を、origin_year昇順のERAカード列に変換する。
 * 各カードの代表アーティスト/作品は、そのカード自身のジャンルIDに直接紐づく
 * genre_highlightのみを使う(子孫分は合算しない。カード列挙は再帰的だが、
 * カード1枚ごとの中身は非再帰的)。 */
export function buildEraCards(
  rootId: string,
  genres: GenreRow[],
  edges: LineageEdge[],
  highlights: HighlightRow[]
): EraCardData[] {
  const descendantIds = getDescendantGenreIds(rootId, edges)
  const genreById = new Map(genres.map((g) => [g.id, g]))
  const orderIndex = new Map(descendantIds.map((id, i) => [id, i]))

  const withYear = descendantIds
    .map((id) => genreById.get(id))
    .filter((g): g is GenreRow => g !== undefined && g.originYear !== null)

  const sorted = [...withYear].sort((a, b) => {
    if (a.originYear! !== b.originYear!) return a.originYear! - b.originYear!
    return orderIndex.get(a.id)! - orderIndex.get(b.id)!
  })

  return sorted.map((genreRow, index) => {
    const genreHighlights = highlights.filter((h) => h.genreId === genreRow.id)

    const representativeArtists = genreHighlights
      .filter((h): h is HighlightRow & { artistId: string; artistName: string } => h.artistId !== null && h.artistName !== null)
      .map((h) => ({ id: h.artistId, name: h.artistName, imageUrl: h.artistImageUrl }))

    const representativeWorks = genreHighlights
      .filter((h): h is HighlightRow & { albumId: string; albumTitle: string } => h.albumId !== null && h.albumTitle !== null)
      .map((h) => ({
        id: h.albumId,
        title: h.albumTitle,
        year: h.eventYear ?? genreRow.originYear,
        artistName: h.artistName,
      }))

    const imageUrl =
      genreHighlights.find((h) => h.artistImageUrl)?.artistImageUrl ??
      genreHighlights.find((h) => h.albumJacketUrl)?.albumJacketUrl ??
      null

    return {
      genreId: genreRow.id,
      period: genreRow.originYearLabel ?? (genreRow.originYear ? `${genreRow.originYear}年` : ''),
      title: genreRow.name,
      region: genreRow.originCountry,
      colorToken: ERA_COLOR_ROTATION[index % ERA_COLOR_ROTATION.length],
      description: genreRow.backgroundNote,
      representativeArtists,
      representativeWorks,
      imageUrl,
    }
  })
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm test`
Expected: `genre-history.unit.test.ts`内の全テストがPASS。

- [ ] **Step 6: 型チェック・lint**

```bash
npx tsc --noEmit
npx eslint utils/genreHistory.ts __tests__/genre-history.unit.test.ts
```

Expected: エラー無し。

- [ ] **Step 7: コミット**

```bash
git add utils/genreHistory.ts __tests__/genre-history.unit.test.ts
git commit -m "feat: add pure era-card generation logic for genre history UI"
```

---

### Task 4: `utils/genreHistory.ts` — ジャンル進化ツリー構築ロジック(TDD)

**Files:**
- Modify: `utils/genreHistory.ts`(Task 3で作成したファイルに追記)
- Test: `__tests__/genre-history.unit.test.ts`(Task 3のファイルに追記)

**Interfaces:**
- Consumes: Task 3の`LineageEdge`、`GenreRow`
- Produces:
  - `type GenreEvolutionNode = { genreId: string; name: string; depth: number }`
  - `type GenreEvolutionEdgeData = { fromGenreId: string; toGenreId: string; relationType: 'derivation' | 'influence' | 'crossover' }`
  - `buildGenreEvolutionTree(rootId: string, genres: GenreRow[], edges: LineageEdge[]): { nodes: GenreEvolutionNode[]; edges: GenreEvolutionEdgeData[] }`

- [ ] **Step 1: 失敗するテストを追記**

`__tests__/genre-history.unit.test.ts`の末尾に追記(importに`buildGenreEvolutionTree`を追加):

```ts
import { getDescendantGenreIds, buildEraCards, buildGenreEvolutionTree, type GenreRow, type LineageEdge, type HighlightRow } from '../utils/genreHistory.ts'
```

```ts
describe('buildGenreEvolutionTree', () => {
  test('assigns depth 0 to root, incrementing depth down a chain', () => {
    const genres: GenreRow[] = [
      genre({ id: 'A', name: 'Blues' }),
      genre({ id: 'B', name: 'Country Blues' }),
      genre({ id: 'C', name: 'Delta Blues' }),
    ]
    const edges: LineageEdge[] = [
      { parentGenreId: 'A', childGenreId: 'B', relationType: 'derivation' },
      { parentGenreId: 'B', childGenreId: 'C', relationType: 'derivation' },
    ]
    const { nodes } = buildGenreEvolutionTree('A', genres, edges)
    assert.deepEqual(
      nodes.map((n) => [n.genreId, n.depth]),
      [
        ['A', 0],
        ['B', 1],
        ['C', 2],
      ]
    )
  })

  test('branches produce siblings at the same depth, in pre-order', () => {
    const genres: GenreRow[] = [
      genre({ id: 'A' }),
      genre({ id: 'B' }),
      genre({ id: 'C' }),
      genre({ id: 'D' }),
    ]
    const edges: LineageEdge[] = [
      { parentGenreId: 'A', childGenreId: 'B', relationType: 'derivation' },
      { parentGenreId: 'B', childGenreId: 'C', relationType: 'derivation' },
      { parentGenreId: 'B', childGenreId: 'D', relationType: 'influence' },
    ]
    const { nodes, edges: resultEdges } = buildGenreEvolutionTree('A', genres, edges)
    assert.deepEqual(
      nodes.map((n) => [n.genreId, n.depth]),
      [
        ['A', 0],
        ['B', 1],
        ['C', 2],
        ['D', 2],
      ]
    )
    assert.deepEqual(
      resultEdges.map((e) => [e.fromGenreId, e.toGenreId, e.relationType]),
      [
        ['A', 'B', 'derivation'],
        ['B', 'C', 'derivation'],
        ['B', 'D', 'influence'],
      ]
    )
  })

  test('a root with no children returns a single node and no edges', () => {
    const genres: GenreRow[] = [genre({ id: 'A' })]
    const { nodes, edges } = buildGenreEvolutionTree('A', genres, [])
    assert.deepEqual(nodes, [{ genreId: 'A', name: 'A', depth: 0 }])
    assert.deepEqual(edges, [])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test`
Expected: `buildGenreEvolutionTree is not a function` 相当のエラーでFAIL。

- [ ] **Step 3: 実装を追記**

`utils/genreHistory.ts`の末尾に追記:

```ts
export type GenreEvolutionNode = {
  genreId: string
  name: string
  depth: number
}

export type GenreEvolutionEdgeData = {
  fromGenreId: string
  toGenreId: string
  relationType: 'derivation' | 'influence' | 'crossover'
}

/** rootIdを根とする系統ツリーを、深さ優先(pre-order)でノード列とエッジ列に変換する。
 * pre-order(親の直後にその子が並ぶ)にしておくことで、UI側は単純な配列の
 * map()だけで入れ子リスト表示ができる。 */
export function buildGenreEvolutionTree(
  rootId: string,
  genres: GenreRow[],
  edges: LineageEdge[]
): { nodes: GenreEvolutionNode[]; edges: GenreEvolutionEdgeData[] } {
  const genreById = new Map(genres.map((g) => [g.id, g]))
  const childrenByParent = new Map<string, LineageEdge[]>()
  for (const edge of edges) {
    const list = childrenByParent.get(edge.parentGenreId) ?? []
    list.push(edge)
    childrenByParent.set(edge.parentGenreId, list)
  }

  const nodes: GenreEvolutionNode[] = []
  const resultEdges: GenreEvolutionEdgeData[] = []
  const seen = new Set<string>()

  function visit(genreId: string, depth: number) {
    if (seen.has(genreId)) return
    seen.add(genreId)
    const genreRow = genreById.get(genreId)
    nodes.push({ genreId, name: genreRow?.name ?? genreId, depth })
    for (const edge of childrenByParent.get(genreId) ?? []) {
      resultEdges.push({ fromGenreId: edge.parentGenreId, toGenreId: edge.childGenreId, relationType: edge.relationType })
      visit(edge.childGenreId, depth + 1)
    }
  }
  visit(rootId, 0)

  return { nodes, edges: resultEdges }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: 全テストPASS。

- [ ] **Step 5: 型チェック・lint**

```bash
npx tsc --noEmit
npx eslint utils/genreHistory.ts __tests__/genre-history.unit.test.ts
```

- [ ] **Step 6: コミット**

```bash
git add utils/genreHistory.ts __tests__/genre-history.unit.test.ts
git commit -m "feat: add genre evolution tree builder"
```

---

### Task 5: `genreHistoryTypes.ts` + `page.tsx`のデータ取得書き換え

**Files:**
- Create: `app/genres/[id]/genreHistoryTypes.ts`
- Modify: `app/genres/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 3/4の`buildEraCards`、`buildGenreEvolutionTree`、`LineageEdge`、`GenreRow`、`HighlightRow`
- Produces: `GenreHistoryViewProps`型(Task 6-9のコンポーネントが受け取るprops契約)

```ts
export type GenreHistoryViewProps = {
  genreName: string
  eraCards: EraCardData[]
  evolutionNodes: GenreEvolutionNode[]
  evolutionEdges: GenreEvolutionEdgeData[]
}
```

- [ ] **Step 1: 型定義ファイルを作成**

`app/genres/[id]/genreHistoryTypes.ts`:

```ts
// app/genres/[id]/genreHistoryTypes.ts
//
// GenreHistoryView以下のコンポーネントが受け取るprops契約。
// utils/genreHistory.tsの型をそのまま再エクスポートし、UIとデータ取得の境界を明示する。

export type { EraCardData, EraColorToken, GenreEvolutionNode, GenreEvolutionEdgeData } from '@/utils/genreHistory'

import type { EraCardData, GenreEvolutionNode, GenreEvolutionEdgeData } from '@/utils/genreHistory'

export type GenreHistoryViewProps = {
  genreName: string
  eraCards: EraCardData[]
  evolutionNodes: GenreEvolutionNode[]
  evolutionEdges: GenreEvolutionEdgeData[]
}
```

- [ ] **Step 2: `page.tsx`を書き換え**

`app/genres/[id]/page.tsx`の全体を以下に置き換える(既存の`GenreTimeline`呼び出し・子ジャンル/ハイライト/リリース取得ロジックを、`genre_lineage`全件取得+`utils/genreHistory.ts`の純粋関数呼び出しに置き換える):

```tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { buildEraCards, buildGenreEvolutionTree, type GenreRow, type LineageEdge, type HighlightRow } from '@/utils/genreHistory'
import GenreHistoryView from './GenreHistoryView'

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function GenreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: genre, error } = await supabase.from('genre').select('*').eq('id', id).single()
  if (error || !genre) {
    notFound()
  }

  // genre_lineageは全体で高々数十行のため、対象ジャンルに絞らず全件取得して
  // utils/genreHistory.tsのgetDescendantGenreIds/buildGenreEvolutionTreeに渡す
  // (多段階の子孫を辿るには、どこまで辿れば止まるか事前にはわからないため)
  const { data: lineageRows } = await supabase.from('genre_lineage').select('parent_genre_id, child_genre_id, relation_type')
  const edges: LineageEdge[] = (lineageRows ?? []).map((r) => ({
    parentGenreId: r.parent_genre_id,
    childGenreId: r.child_genre_id,
    relationType: r.relation_type as 'derivation' | 'influence' | 'crossover',
  }))

  const descendantIds = new Set<string>([id])
  {
    // buildEraCards内部でも同じ列挙をするが、genreHighlightをどのジャンルID分
    // 取得すればよいかを先に知る必要があるため、ここでも軽量に列挙する
    const childrenByParent = new Map<string, string[]>()
    for (const edge of edges) {
      const list = childrenByParent.get(edge.parentGenreId) ?? []
      list.push(edge.childGenreId)
      childrenByParent.set(edge.parentGenreId, list)
    }
    const queue = [id]
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const child of childrenByParent.get(current) ?? []) {
        if (descendantIds.has(child)) continue
        descendantIds.add(child)
        queue.push(child)
      }
    }
  }
  const allGenreIds = Array.from(descendantIds)

  const [{ data: genreRows }, { data: highlightRows }] = await Promise.all([
    supabase
      .from('genre')
      .select('id, name, origin_year, origin_year_label, origin_country, background_note')
      .in('id', allGenreIds),
    supabase
      .from('genre_highlight')
      .select('genre_id, note, event_year, event_year_label, artist:artist_id(id, name, image_url), album:album_id(id, title, jacket_url)')
      .in('genre_id', allGenreIds),
  ])

  const genres: GenreRow[] = (genreRows ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    originYear: g.origin_year,
    originYearLabel: g.origin_year_label,
    originCountry: g.origin_country,
    backgroundNote: g.background_note,
  }))

  const highlights: HighlightRow[] = (highlightRows ?? []).map((h) => {
    const artist = firstOf(h.artist)
    const album = firstOf(h.album)
    return {
      genreId: h.genre_id,
      artistId: artist?.id ?? null,
      artistName: artist?.name ?? null,
      artistImageUrl: artist?.image_url ?? null,
      albumId: album?.id ?? null,
      albumTitle: album?.title ?? null,
      albumJacketUrl: album?.jacket_url ?? null,
      eventYear: h.event_year,
      eventYearLabel: h.event_year_label,
      note: h.note,
    }
  })

  const eraCards = buildEraCards(id, genres, edges, highlights)
  const { nodes: evolutionNodes, edges: evolutionEdges } = buildGenreEvolutionTree(id, genres, edges)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">{genre.name}</h1>
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

      <GenreHistoryView
        genreName={genre.name}
        eraCards={eraCards}
        evolutionNodes={evolutionNodes}
        evolutionEdges={evolutionEdges}
      />
    </div>
  )
}
```

備考: `genre.origin_year_label`/`genre.origin_country`をヘッダーに表示していた既存の行は、ERAカードの1枚目(対象ジャンル自身)に同じ情報が表示されるため削除した(重複表示を避ける)。

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: `GenreHistoryView`が未作成なので`Cannot find module './GenreHistoryView'`でFAIL(想定内。Task 8で作成する)。ここでは`page.tsx`自体・`genreHistoryTypes.ts`の記述に構文/型エラーが無いことだけ目視確認する。

- [ ] **Step 4: コミット**

```bash
git add app/genres/[id]/genreHistoryTypes.ts app/genres/[id]/page.tsx
git commit -m "feat: rewrite genre page data fetching for card-based history UI"
```

(この時点ではビルドは通らない。Task 8完了後に通るようになる。SDD実行時はこの中間状態を次タスクへそのまま引き継ぐ。)

---

### Task 6: `EraCard.tsx` + `EraTimeline.tsx`

**Files:**
- Create: `app/genres/[id]/EraCard.tsx`
- Create: `app/genres/[id]/EraTimeline.tsx`

**Interfaces:**
- Consumes: `EraCardData`(`@/utils/genreHistory`)
- Produces:
  - `EraCard`: `{ card: EraCardData; isSelected: boolean; onSelect: () => void }`を受け取るコンポーネント
  - `EraTimeline`: `{ cards: EraCardData[]; selectedGenreId: string | null; onSelect: (genreId: string) => void }`を受け取るコンポーネント。円形ノード行+カード行を両方描画する

- [ ] **Step 1: `EraCard.tsx`を作成**

```tsx
'use client'

import { useState } from 'react'
import type { EraCardData, EraColorToken } from '@/utils/genreHistory'

const COLOR_CLASSES: Record<EraColorToken, { ring: string; border: string; text: string; dot: string }> = {
  amber: { ring: 'ring-amber-400/50', border: 'border-amber-400/60', text: 'text-amber-400', dot: 'bg-amber-400' },
  yellow: { ring: 'ring-yellow-300/50', border: 'border-yellow-300/60', text: 'text-yellow-300', dot: 'bg-yellow-300' },
  green: { ring: 'ring-emerald-400/50', border: 'border-emerald-400/60', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  blue: { ring: 'ring-sky-400/50', border: 'border-sky-400/60', text: 'text-sky-400', dot: 'bg-sky-400' },
  coral: { ring: 'ring-orange-400/50', border: 'border-orange-400/60', text: 'text-orange-400', dot: 'bg-orange-400' },
  purple: { ring: 'ring-violet-400/50', border: 'border-violet-400/60', text: 'text-violet-400', dot: 'bg-violet-400' },
}

function CardImage({ card }: { card: EraCardData }) {
  const [loadFailed, setLoadFailed] = useState(false)

  if (!card.imageUrl || loadFailed) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-2xl font-bold text-white/20">
        {card.title.slice(0, 1)}
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={card.imageUrl}
      alt={card.title}
      onError={() => setLoadFailed(true)}
      className="aspect-square w-full rounded-md object-cover transition duration-300 group-hover:scale-105"
    />
  )
}

export default function EraCard({
  card,
  isSelected,
  onSelect,
}: {
  card: EraCardData
  isSelected: boolean
  onSelect: () => void
}) {
  const colors = COLOR_CLASSES[card.colorToken]
  const primaryArtist = card.representativeArtists[0]
  const primaryWork = card.representativeWorks[0]

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group flex w-56 shrink-0 snap-start flex-col rounded-lg border bg-[#141414] p-4 text-left transition duration-200 hover:-translate-y-1 hover:border-white/40 ${
        isSelected ? `${colors.border} ring-2 ${colors.ring}` : 'border-white/10'
      }`}
    >
      <p className={`text-xs font-semibold uppercase tracking-wide ${colors.text}`}>{card.period}</p>
      <h3 className="mt-1 line-clamp-2 text-sm font-bold leading-snug text-white/90">{card.title}</h3>

      <div className="mt-3">
        <CardImage card={card} />
      </div>

      <div className="mt-3 min-h-[2.5rem] text-xs text-white/60">
        {primaryArtist && <p className="truncate font-medium text-white/80">{primaryArtist.name}</p>}
        {primaryWork && (
          <p className="truncate">
            「{primaryWork.title}」{primaryWork.year ? `(${primaryWork.year})` : ''}
          </p>
        )}
      </div>

      <span className="mt-3 flex items-center gap-1 text-xs text-white/40 transition group-hover:translate-x-0.5 group-hover:text-white/70">
        詳細を見る <span aria-hidden>→</span>
      </span>

      {isSelected && (
        <span className={`mx-auto mt-2 h-0 w-0 border-x-8 border-t-8 border-x-transparent ${colors.text.replace('text-', 'border-t-')}`} />
      )}
    </button>
  )
}

export { COLOR_CLASSES }
export type { EraColorToken as EraCardColorToken }
```

備考: カード全体がクリックで選択状態を切り替えるボタンになっており、個々のアーティスト名/作品名へのリンクはTask 7の詳細パネル側に置く(カードの中に別のリンクを重ねるとクリック領域が競合するため)。

- [ ] **Step 2: `EraTimeline.tsx`を作成**

```tsx
'use client'

import { useRef } from 'react'
import type { EraCardData } from '@/utils/genreHistory'
import EraCard, { COLOR_CLASSES } from './EraCard'

export default function EraTimeline({
  cards,
  selectedGenreId,
  onSelect,
}: {
  cards: EraCardData[]
  selectedGenreId: string | null
  onSelect: (genreId: string) => void
}) {
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  function handleSelect(genreId: string) {
    onSelect(genreId)
    cardRefs.current.get(genreId)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }

  if (cards.length === 0) {
    return <p className="mt-4 text-sm text-white/40">まだ年表に表示できる出来事が登録されていません。</p>
  }

  return (
    <div className="mt-6">
      {/* 円形ノード+接続ライン(横一列) */}
      <div className="flex items-center overflow-x-auto pb-2">
        {cards.map((card, i) => (
          <div key={card.genreId} className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => handleSelect(card.genreId)}
              className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 text-center text-[11px] font-semibold leading-tight transition ${
                selectedGenreId === card.genreId
                  ? `${COLOR_CLASSES[card.colorToken].border} bg-white/10 text-white`
                  : 'border-white/15 text-white/50 hover:border-white/30'
              }`}
            >
              {card.period}
            </button>
            {i < cards.length - 1 && <span className="mx-1 h-px w-8 shrink-0 bg-white/15" />}
          </div>
        ))}
      </div>

      {/* カード本体(横スクロール、スマホでも横スクロールのまま) */}
      <div className="mt-4 flex snap-x gap-4 overflow-x-auto pb-4">
        {cards.map((card) => (
          <div
            key={card.genreId}
            ref={(el) => {
              if (el) cardRefs.current.set(card.genreId, el)
              else cardRefs.current.delete(card.genreId)
            }}
          >
            <EraCard card={card} isSelected={selectedGenreId === card.genreId} onSelect={() => handleSelect(card.genreId)} />
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 型チェック・lint**

```bash
npx tsc --noEmit
npx eslint app/genres/\[id\]/EraCard.tsx app/genres/\[id\]/EraTimeline.tsx
```

Expected: `page.tsx`の`GenreHistoryView`未解決エラーのみ残り、`EraCard.tsx`/`EraTimeline.tsx`自体にはエラーが無いこと。

- [ ] **Step 4: コミット**

```bash
git add app/genres/[id]/EraCard.tsx app/genres/[id]/EraTimeline.tsx
git commit -m "feat: add EraCard and EraTimeline components"
```

---

### Task 7: `EraDetailPanel.tsx`

**Files:**
- Create: `app/genres/[id]/EraDetailPanel.tsx`

**Interfaces:**
- Consumes: `EraCardData`(`@/utils/genreHistory`)
- Produces: `{ card: EraCardData }`を受け取り3カラムの詳細を表示するコンポーネント

- [ ] **Step 1: 実装**

```tsx
'use client'

import Link from 'next/link'
import type { EraCardData } from '@/utils/genreHistory'

export default function EraDetailPanel({ card }: { card: EraCardData }) {
  return (
    <div key={card.genreId} className="mt-6 rounded-lg border border-white/10 bg-white/[0.02] p-6 transition-opacity duration-200">
      <p className="text-xs uppercase tracking-wide text-white/40">選択中</p>
      <h2 className="mt-1 text-lg font-bold">
        {card.period} ・ {card.title}
        {card.region && <span className="ml-2 text-sm font-normal text-white/40">{card.region}</span>}
      </h2>

      <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-white/40">歴史・出来事</h3>
          <p className="mt-2 text-sm leading-relaxed text-white/70">
            {card.description ?? 'まだ解説が登録されていません。'}
          </p>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-white/40">代表アーティスト</h3>
          {card.representativeArtists.length === 0 ? (
            <p className="mt-2 text-sm text-white/40">まだ登録されていません。</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {card.representativeArtists.map((artist) => (
                <li key={artist.id}>
                  <Link href={`/artists/${artist.id}`} className="text-sm text-white/80 hover:text-white hover:underline">
                    {artist.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-white/40">代表作品</h3>
          {card.representativeWorks.length === 0 ? (
            <p className="mt-2 text-sm text-white/40">まだ登録されていません。</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {card.representativeWorks.map((work) => (
                <li key={work.id}>
                  <Link href={`/albums/${work.id}`} className="text-sm text-white/80 hover:text-white hover:underline">
                    {work.artistName ? `${work.artistName}「${work.title}」` : `「${work.title}」`}
                  </Link>
                  {work.year && <span className="ml-1 text-xs text-white/40">({work.year})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 型チェック・lint**

```bash
npx tsc --noEmit
npx eslint app/genres/\[id\]/EraDetailPanel.tsx
```

- [ ] **Step 3: コミット**

```bash
git add app/genres/[id]/EraDetailPanel.tsx
git commit -m "feat: add EraDetailPanel component"
```

---

### Task 8: `GenreHistoryView.tsx`(状態管理・組み立て)

**Files:**
- Create: `app/genres/[id]/GenreHistoryView.tsx`

**Interfaces:**
- Consumes: `GenreHistoryViewProps`(`./genreHistoryTypes`)、`EraTimeline`(Task 6)、`EraDetailPanel`(Task 7)、`GenreEvolution`(Task 9で作成するが、このタスクでは先にpropsの受け渡し口だけ作り、Task 9で中身を実装する)
- Produces: `page.tsx`(Task 5)が`import GenreHistoryView from './GenreHistoryView'`で参照するデフォルトエクスポート

- [ ] **Step 1: 実装**

```tsx
'use client'

import { useState } from 'react'
import type { GenreHistoryViewProps } from './genreHistoryTypes'
import EraTimeline from './EraTimeline'
import EraDetailPanel from './EraDetailPanel'
import GenreEvolution from './GenreEvolution'

export default function GenreHistoryView({ genreName, eraCards, evolutionNodes, evolutionEdges }: GenreHistoryViewProps) {
  const [selectedGenreId, setSelectedGenreId] = useState<string | null>(eraCards[0]?.genreId ?? null)
  const selectedCard = eraCards.find((c) => c.genreId === selectedGenreId) ?? null

  return (
    <div className="animate-[fadein_0.3s_ease-in]">
      <EraTimeline cards={eraCards} selectedGenreId={selectedGenreId} onSelect={setSelectedGenreId} />

      {selectedCard && <EraDetailPanel card={selectedCard} />}

      {evolutionNodes.length > 1 && (
        <div className="mt-10 border-t border-white/10 pt-8">
          <h2 className="text-lg font-semibold">GENRE EVOLUTION</h2>
          <p className="mt-1 text-xs text-white/40">{genreName}からのジャンルの派生・影響関係</p>
          <GenreEvolution nodes={evolutionNodes} edges={evolutionEdges} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: fade-inアニメーションのCSSを定義**

`app/globals.css`の末尾に追記(既存のCSS変数定義の後ろ、ファイル末尾):

```css
@keyframes fadein {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
```

- [ ] **Step 3: 型チェック(Task 9未完了のため`GenreEvolution`は仮実装が必要)**

このタスク単体ではまだ`./GenreEvolution`が存在せずビルドが通らない。Task 9で解消される前提でコミットする(Task 5と同様の中間状態)。

- [ ] **Step 4: コミット**

```bash
git add app/genres/[id]/GenreHistoryView.tsx app/globals.css
git commit -m "feat: add GenreHistoryView to wire timeline, detail panel and evolution graph"
```

---

### Task 9: `GenreEvolution.tsx` + `GenreEvolutionNode.tsx`

**Files:**
- Create: `app/genres/[id]/GenreEvolutionNode.tsx`
- Create: `app/genres/[id]/GenreEvolution.tsx`

**Interfaces:**
- Consumes: `GenreEvolutionNode`、`GenreEvolutionEdgeData`(`@/utils/genreHistory`)
- Produces: `GenreEvolution`コンポーネント(`{ nodes: GenreEvolutionNode[]; edges: GenreEvolutionEdgeData[] }`を受け取る)。Task 8の`GenreHistoryView.tsx`がこれをimportして初めてビルドが通るようになる

- [ ] **Step 1: `GenreEvolutionNode.tsx`を作成**

```tsx
import Link from 'next/link'

const EDGE_STYLE_LABEL: Record<'derivation' | 'influence' | 'crossover', string> = {
  derivation: '実線',
  influence: '点線',
  crossover: '破線',
}

export function EdgeLine({ relationType }: { relationType: 'derivation' | 'influence' | 'crossover' }) {
  const borderStyle = relationType === 'derivation' ? 'solid' : relationType === 'influence' ? 'dotted' : 'dashed'
  return <span className="h-4 w-4 border-l" style={{ borderLeftStyle: borderStyle, borderLeftColor: 'rgba(255,255,255,0.3)' }} />
}

export default function GenreEvolutionNode({
  genreId,
  name,
  incomingRelationType,
}: {
  genreId: string
  name: string
  incomingRelationType?: 'derivation' | 'influence' | 'crossover'
}) {
  return (
    <div className="flex items-center gap-1.5">
      {incomingRelationType && <EdgeLine relationType={incomingRelationType} />}
      <Link
        href={`/genres/${genreId}`}
        className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/75 transition hover:border-white/30 hover:bg-white/[0.05] hover:text-white"
      >
        {name}
      </Link>
    </div>
  )
}

export { EDGE_STYLE_LABEL }
```

- [ ] **Step 2: `GenreEvolution.tsx`を作成**

```tsx
import type { GenreEvolutionNode as GenreEvolutionNodeData, GenreEvolutionEdgeData } from '@/utils/genreHistory'
import GenreEvolutionNode, { EDGE_STYLE_LABEL } from './GenreEvolutionNode'

export default function GenreEvolution({
  nodes,
  edges,
}: {
  nodes: GenreEvolutionNodeData[]
  edges: GenreEvolutionEdgeData[]
}) {
  // 各ノードへの「入ってくる」エッジの種類(親から見た自分向けの関係)を引けるようにする
  const incomingRelationByGenreId = new Map(edges.map((e) => [e.toGenreId, e.relationType]))

  return (
    <div className="mt-4">
      <ul className="space-y-2">
        {nodes.map((node) => (
          <li key={node.genreId} style={{ marginLeft: `${node.depth * 1.5}rem` }}>
            <GenreEvolutionNode
              genreId={node.genreId}
              name={node.name}
              incomingRelationType={incomingRelationByGenreId.get(node.genreId)}
            />
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-4 text-[11px] text-white/40">
        {(Object.keys(EDGE_STYLE_LABEL) as (keyof typeof EDGE_STYLE_LABEL)[]).map((relationType) => (
          <span key={relationType} className="flex items-center gap-1.5">
            <span
              className="inline-block h-0 w-4 border-t"
              style={{
                borderTopStyle: relationType === 'derivation' ? 'solid' : relationType === 'influence' ? 'dotted' : 'dashed',
                borderTopColor: 'rgba(255,255,255,0.4)',
              }}
            />
            {relationType === 'derivation' ? '主な派生' : relationType === 'influence' ? '影響' : 'クロスオーバー'}
          </span>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 型チェック・lint(このタスクでpage.tsx〜GenreHistoryViewの依存が全て解消される)**

```bash
npx tsc --noEmit
npx eslint app/genres/\[id\]/GenreEvolution.tsx app/genres/\[id\]/GenreEvolutionNode.tsx app/genres/\[id\]/GenreHistoryView.tsx app/genres/\[id\]/page.tsx
```

Expected: エラー無し(Task 5〜9まで全ての依存が揃うため、ここで初めて`npx tsc --noEmit`がプロジェクト全体でクリーンになる)。

- [ ] **Step 4: コミット**

```bash
git add app/genres/[id]/GenreEvolution.tsx app/genres/[id]/GenreEvolutionNode.tsx
git commit -m "feat: add GenreEvolution tree visualization"
```

---

### Task 10: 旧タイムラインの削除・最終統合・手動確認

**Files:**
- Delete: `app/genres/[id]/GenreTimeline.tsx`
- Delete: `utils/genreTimeline.ts`
- Delete: `__tests__/genre-timeline.unit.test.ts`

**Interfaces:**
- Consumes: Task 1〜9の全成果物

- [ ] **Step 1: 旧ファイルを削除**

```bash
git rm app/genres/\[id\]/GenreTimeline.tsx utils/genreTimeline.ts __tests__/genre-timeline.unit.test.ts
```

- [ ] **Step 2: 削除後も参照が残っていないことを確認**

```bash
grep -rn "GenreTimeline\|genreTimeline" app utils __tests__ --include="*.ts" --include="*.tsx"
```

Expected: 0件(Task 5で`page.tsx`は既に新UIに置き換え済みのため)。

- [ ] **Step 3: 型チェック・lint・テスト一式**

```bash
npx tsc --noEmit
npx eslint app/genres/\[id\]/*.tsx app/genres/\[id\]/*.ts utils/genreHistory.ts app/globals.css
npm test
```

Expected: 全てエラー無し・全テストPASS。

- [ ] **Step 4: ローカルでの手動確認**

開発サーバーを起動し、Basic認証つきcurlで以下を確認する:

```bash
npm run dev &
sleep 3
source .env.local
curl -s -u "${BASIC_AUTH_USER}:${BASIC_AUTH_PASSWORD}" -o /dev/null -w "blues=%{http_code}\n" "http://localhost:3000/genres/MS_GNR_2iqbgazg"
curl -s -u "${BASIC_AUTH_USER}:${BASIC_AUTH_PASSWORD}" -o /dev/null -w "sparse=%{http_code}\n" "http://localhost:3000/genres/MS_GNR_yujtye4p"
```

(2件目`MS_GNR_yujtye4p`は`hard rock`。ブルース経由でderivationの子になった直後の、代表アーティスト/作品を持たない薄いジャンルの例として、レイアウトが崩れないことを確認する用途)

ブラウザでも実際に以下を目視確認する:
- ブルースのページ(`/genres/MS_GNR_2iqbgazg`)でカードが10枚前後、origin_year順に並んでいること
- カードをクリックすると選択状態になり、下に詳細パネルが表示されること
- 「シカゴ・ブルース」のカードの代表アーティストにRolling Stones等(ブルース・ロックの子孫)が混入していないこと(Muddy Waters/Howlin' Wolf/B.B. Kingのみ)
- GENRE EVOLUTIONセクションで、ブルース・ロック→hard rockが実線、ブルース・ロック→garage rockが点線で表示されること
- 代表アーティスト/作品0件のジャンル(例: hard rock)のページでレイアウトが崩れないこと
- スマートフォン幅(375px程度)でカード行が横スクロールし、縦に6枚積まれる形になっていないこと
- 日本語の長いジャンル名・アーティスト名(例:「クラシック・フィメール・ブルース」)でカードの高さが崩れないこと

- [ ] **Step 5: 開発サーバーを停止**

```bash
lsof -ti:3000 | xargs kill -9
```

- [ ] **Step 6: コミット**

```bash
git commit -m "chore: remove legacy GenreTimeline in favor of card-based genre history UI"
```
