# イベント一覧・詳細公開ページ 設計

## 背景

`event`・`event_edition`・`event_appearance`・`music_event` テーブルの管理画面とアーティスト詳細ページへの組み込みは既に完了している([2026-08-06-event-content](./2026-08-06-event-content-design.md))。そのプランでは「イベント単体の一覧・詳細公開ページ(`/events` 等)」を非ゴールとして見送っていたが、今回はその公開ページを作る。

## ゴール

- `/events` に、イベント一覧ページ(種別フィルター付き)を追加する
- `/events/[id]` に、イベント詳細ページ(開催回・出演アーティスト一覧)を追加する
- 同一開催回内で複数会場(例: SUMMER SONIC の東京・大阪)を持つフェスに対応する
- ホーム画面の「イベント」統計タイルから `/events` へ遷移できるようにする

## 非ゴール(今回やらないこと)

- イベント名・概要のフリーテキスト検索(フィルターは種別のみ)
- `event_genre`
- 一覧・詳細ページからの編集・削除UI(管理画面は `/admin/data` のまま)
- `music_event`(単独公演)のこのページへの表示。`event` テーブルと無関係なため対象外。既存のアーティスト詳細ページ「Live & Festivals」がそのまま担当領域
- 同一開催回・同一会場内での同一アーティストの複数日出演(例: 大阪1日目と3日目の両方に出演)。一意制約の都合上、今回は「会場が異なれば複数出演行を許可する」までとし、同一会場での複数日出演は対象外とする

## データモデルの変更

複数会場フェス(同じ年の開催回の中で、東京と大阪のように会場ごとに異なるラインナップがある)に対応するため、`event_edition` は今まで通り1年に1件のまま、会場は `event_appearance` 側に持たせる。

- `event_appearance` に `venue`(text, nullable)列を追加する。未設定(null)の場合は表示時に `event_edition.venue` にフォールバックする。
- 前プランで追加した一意制約 `event_appearance_edition_artist_key`(`event_edition_id, artist_id`)を、会場違いなら複数出演行を許可するよう変更する。ただし `venue` は null 許容のため、単純に `(event_edition_id, artist_id, venue)` に列を足すだけでは、Postgresは NULL 同士を「異なる値」とみなすため、venue未入力(単一会場イベントの通常運用)では重複防止が効かなくなってしまう。そのため空文字とnullを同一視する式インデックスに置き換える:

```sql
drop index if exists event_appearance_edition_artist_key;
create unique index event_appearance_edition_artist_venue_key
  on event_appearance (event_edition_id, artist_id, coalesce(venue, ''));
```

- これにより: 同じ開催回・同じアーティスト・同じ会場(または両方未入力)の重複登録は引き続きブロックされる。会場が異なれば(例: 大阪/東京)、同じアーティスト・同じ開催回でも複数行登録できる。

## アーキテクチャ

既存の `app/media/sync/page.tsx`(一覧)+ `app/media/sync/[id]/page.tsx`(詳細)のペアと同じ設計原則を踏襲する。新しい抽象化は導入しない。

```
app/events/page.tsx (新規)
  └─ event_type フィルター付き一覧。名前順。

app/events/[id]/page.tsx (新規)
  └─ イベント詳細 + 開催回セレクター(?year=) + 会場/ステージ別出演アーティスト一覧

app/page.tsx (既存に変更)
  └─ STAT_ITEMS の「イベント」タイルのみ /events へのリンクにする

app/admin/data/actions.ts (既存に変更)
  └─ createEventAppearance に venue パラメータを追加

app/admin/data/page.tsx (既存に変更)
  └─ 「出演登録」フォームに会場入力(任意)を追加
```

- 読み取りは既存の `createClient()`(RLS前提)のみ使用。
- 管理画面側は「出演登録」フォームへの会場入力追加のみ。他の変更はなし。
- 存在しないイベントIDは `notFound()`(`app/media/sync/[id]/page.tsx` と同じパターン)。

## コンポーネント

### `app/events/page.tsx`(新規)

- `searchParams: Promise<{ event_type?: string }>` を受け取る
- `event` を `id, name, event_type, founded_year` で取得し、`event_type` が指定されていれば `.eq('event_type', eventType)`、名前順(`order('name')`)
- フィルター `<select name="event_type">` は `app/media/sync/page.tsx` の `<form action="/events">` + `<select>` と同じUI(全て/フェス/単発イベント/その他)
- 各行はカードまたはテーブル行(`app/media/sync/page.tsx` のテーブル行パターンを踏襲)。イベント名(`/events/{id}` へリンク)・種別ラベル・発祥年を表示
- 0件時: 「該当するイベントが登録されていません。」

### `app/events/[id]/page.tsx`(新規)

- `params: Promise<{ id: string }>`、`searchParams: Promise<{ year?: string }>`
- `event` を `id` で1件取得(`notFound()` ガード)
- その `event` の `event_edition` を `id, year, start_date, end_date, venue, description` で取得、年降順
- 選択中の年 = `searchParams.year` があればそれに一致する edition、なければ先頭(最新)の edition
- 開催回が0件の場合: 年セレクターと出演一覧は表示せず「まだ開催情報が登録されていません。」を表示して終了
- 年セレクターは、`event_edition` の各 `year` を選択中年へのリンク(`/events/{id}?year={year}`)として横並び表示(ピル/タブ)
- 選択中の edition 情報(会場・開催期間・概要)を表示
- その edition の `event_appearance` を `id, stage, venue, is_headliner, artist:artist_id(id, name)` で取得
  - 各行の実効会場 = `row.venue ?? edition.venue ?? null`
  - 実効会場の種類が2種類以上ある場合のみ「会場 → ステージ」の2階層グループ化(会場ごとに `Map`、その中でさらに `stage` ごとに `Map`)。会場が1種類のみ(全員フォールバック含む)の場合は、従来通り `stage` のみの1階層グループ化にし、単一会場イベントで無駄な見出しを増やさない
  - `stage` が null のものは `'その他'` キーにまとめる(会場グルーピングの有無に関わらず)
  - 各グループ内でアーティスト名を `/artists/{id}` へリンク、`is_headliner` なら「★ヘッドライナー」を付記(既存の表記を踏襲)
  - 0件時: 「まだ出演アーティストが登録されていません。」

### `app/admin/data/actions.ts`(変更)

- `createEventAppearance` に `venue`(text, 任意、空文字は null)を追加し、`event_appearance.insert()` に含める

### `app/admin/data/page.tsx`(変更)

- 「出演登録」フォームに `venue` の text input(任意、placeholder「会場(任意・複数会場フェスの場合のみ入力)」)を追加
- 出演情報の一覧表示に、`venue` が設定されている場合のみ会場名を併記

### `app/page.tsx`(変更)

- `STAT_ITEMS` の各要素に任意の `href?: string` を追加し、`event` の要素にのみ `href: '/events'` を設定
- レンダリング側で `href` があれば `<Link>`、なければ現行どおり `<div>` のまま(他の4タイルは変更なし)

## データフロー

1. `/events` でイベントを見つけ、詳細へ遷移
2. `/events/[id]` で開催回を年セレクターで切り替えながら、その回の出演アーティストを確認
3. 出演アーティスト名から `/artists/[id]` へ遷移し、既存の「Live & Festivals」セクションで同じ出演情報を別の切り口(アーティスト起点)からも確認できる

## エラーハンドリング

- 存在しない `id` → `notFound()`
- `event_type` に不正な値が渡された場合、該当0件として通常のフィルター結果と同様に表示(エラー扱いにしない。`.eq()` が単に一致なしを返すだけのため)
- `year` に対応する edition が存在しない場合、最新年にフォールバック表示(壊れたリンクで空白ページにしない)

## テスト方針

- 自動テストは追加しない(既存の検証スタイルに合わせる)
- 実装後に `npx tsc --noEmit` + Playwright/curlで実機確認:
  1. `/events` に種別フィルターが表示され、フィルター適用で件数が変わることを確認
  2. `/events/[id]` で開催回が複数ある場合に年セレクターが機能し、出演アーティストがステージ別にグループ化されて表示されることを確認
  3. 同じ開催回に会場違いの出演を2件以上登録し、詳細ページで「会場→ステージ」の2階層グループ化になることを確認。さらに同じアーティストを会場違いで2回登録できること、同じ会場では重複登録が拒否されることを確認
  4. 開催回・出演者が0件のイベントで、それぞれの空状態メッセージが表示されることを確認
  5. ホーム画面の「イベント」タイルが `/events` へのリンクになっていることを確認
  6. テストデータは明示的にラベル付けし、検証後にSupabase管理クライアントで削除・0件確認する
