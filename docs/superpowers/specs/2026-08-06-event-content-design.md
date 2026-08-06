# イベントコンテンツ(ライブ・フェス出演歴) 設計

## 背景

`event`・`event_edition`・`event_appearance`・`music_event`テーブルは既にDBに存在するが(全て0件)、登録できる管理画面も、表示するページも無い。以前のアーティスト詳細ページ再構築(2026-08-06)では、この4テーブルに対応する「Live & Festivals」セクションを「新規テーブル設計が必要」という理由で非ゴールとして見送っていた。テーブルは既に用意されているため、今回はその管理画面と表示を実装する。

## ゴール

- `/admin/data`に、`event`・`event_edition`・`event_appearance`・`music_event`の4つを登録できるフォームを追加する
- `/artists/[id]`ページに「Live & Festivals」セクションを追加し、そのアーティストの単独公演(`music_event`)とフェス出演歴(`event_appearance`)を表示する

## 非ゴール(今回やらないこと)

- `event_genre`(イベントのジャンルタグ付け)。表示箇所が無いため今回は登録フォームも作らない
- イベント単体の一覧・詳細公開ページ(`/events`等)。今回はアーティスト詳細ページへの組み込みのみ
- イベントの編集・削除UI(既存の他エンティティと同様、登録のみ)
- `event_edition`・`event_appearance`の一括インポート。手動登録のみ

## データの前提

- `event.event_type`にはCHECK制約があり、`festival`/`one_off_live`/`other`の3値のみ許可される(`pg_constraint`で確認済み)。表示ラベルはフェス/単発イベント/その他とする。
- `event_edition.event_id → event.id`、`event_appearance.event_edition_id → event_edition.id`、`event_appearance.artist_id → artist.id`、`music_event.artist_id → artist.id`の外部キーが既に張られている(`information_schema`で確認済み)。
- `event`・`event_edition`・`event_appearance`・`music_event`のいずれも現在0件。データ移行は不要。

## アーキテクチャ

```
/admin/data/page.tsx (既存に追記)
  └─ 新規セクション「イベント」: 4つのフォーム(イベント登録・開催回登録・出演登録・単独公演登録)
     + 直近の登録内容を一覧表示(既存の他セクションと同じパターン)

app/admin/data/actions.ts (既存に追記)
  ├─ createEvent(formData)
  ├─ createEventEdition(formData)
  ├─ createEventAppearance(formData)
  └─ createMusicEvent(formData)
     いずれも既存の createLabel 等と同じパターン(createAdminClient・空文字→null・redirectWith)。
     createEventAppearance / createMusicEvent は成功時に revalidatePath(`/artists/${artistId}`) も呼ぶ
     (公開ページである /artists/[id] に反映されるため)。

app/artists/[id]/page.tsx (既存に追記)
  └─ 新規セクション「Live & Festivals」(SectionDividerを再利用、Biographyの直後・Discographyの直前)
     ├─ この artist の music_event を event_date 降順で取得 → LIVE INFO カード
     └─ この artist の event_appearance を event_edition 経由で event 名・年を取得、年降順で取得 → FESTIVAL APPEARANCES カード
```

- 管理画面の4フォームは既存の各セクション(ジャンル・レーベル・メディア等)と全く同じ設計原則(1テーブル1フォーム、`<select>`は既存データから生成、成功/失敗は`redirectWith`)を踏襲する。新しい抽象化は導入しない。
- アーティスト詳細ページの2カード表示は、デザインコンセプトの`.two-col`(LIVE INFO / FESTIVAL APPEARANCES)構成を踏襲するが、色・フォントは既存のダークテーマのまま(アーティスト詳細ページ再構築時の方針を継承)。

## コンポーネント

### `/admin/data/page.tsx` の変更

新規セクション「イベント」を追加(既存の`<section className="mt-10 border-t border-white/10 pt-8">`パターン)。既存の`artistOptions`を再利用。新たに以下のデータを取得:
- `events`(id, name, event_type) — イベント選択セレクト用
- `eventEditions`(id, year, event:event_id(name)) — 開催回選択セレクト用、表示は「イベント名(年)」
- 直近の登録一覧表示用に、event / event_edition / event_appearance(artist名・event名・年・stage) / music_event(artist名・公演名・日付) を簡易取得

フォーム項目:
1. **イベント登録**(`createEvent`): `name`(必須), `event_type`(select: フェス/単発イベント/その他), `founded_year`(number, 任意), `country`(text, 任意), `prefecture`(text, 任意、自由入力), `description`(text, 任意)
2. **開催回登録**(`createEventEdition`): `event_id`(select, 必須), `year`(number, 必須), `start_date`/`end_date`(date, 任意), `venue`(text, 任意), `description`(text, 任意)
3. **出演登録**(`createEventAppearance`): `event_edition_id`(select「イベント名(年)」表示, 必須), `artist_id`(select, 必須), `stage`(text, 任意), `start_time`/`end_time`(datetime-local, 任意), `is_headliner`(checkbox)
4. **単独公演登録**(`createMusicEvent`): `artist_id`(select, 必須), `name`(text, 必須), `event_date`(date, 任意), `venue`(text, 任意), `prefecture`(text, 任意), `description`(text, 任意)

### `app/admin/data/actions.ts` の変更

4つの新規サーバーアクションを追加。全て既存の`createLabel`等と同じ構造(必須項目チェック→`redirectWith('error', ...)`→`createAdminClient()`→`insert()`→成功/失敗の`redirectWith`)。

- `createEvent`: `name`必須。`event_type`は空文字なら`null`。
- `createEventEdition`: `event_id`・`year`必須。
- `createEventAppearance`: `event_edition_id`・`artist_id`必須。`is_headliner`はチェックボックスなので`formData.get('is_headliner') === 'on'`で真偽値化。成功時に`revalidatePath('/admin/data')`に加え`revalidatePath(`/artists/${artistId}`)`。
- `createMusicEvent`: `artist_id`・`name`必須。成功時に`revalidatePath('/admin/data')`に加え`revalidatePath(`/artists/${artistId}`)`。

### `app/artists/[id]/page.tsx` の変更

- 既存の`SectionDivider`をそのまま再利用(新規コンポーネント不要)。
- データ取得: 初期の`Promise.all`に以下を追加
  - `music_event`を`artist_id`で絞り込み、`event_date`降順
  - `event_appearance`を`artist_id`で絞り込み、`event_edition:event_edition_id(year, event:event_id(name))`をjoinして取得、年降順
- 挿入位置: Biographyブロックの直後、Discography(`SectionDivider label="Discography"`)の直前。
- 表示: `<SectionDivider label="Live & Festivals" />`の下に、モックの`.two-col`相当の2カラム(`grid grid-cols-1 gap-4 sm:grid-cols-2`)。左に「LIVE INFO」カード(`music_event`一覧: 日付・公演名・会場)、右に「FESTIVAL APPEARANCES」カード(`event_appearance`一覧: イベント名(年)・ステージ・ヘッドライナーなら★等の表示)。
- 空状態: Discography・Relation Graphセクションと同じ慣習で、セクション自体は常に表示し、各カード内でデータが0件なら「まだライブ情報がありません。」「まだフェス出演歴がありません。」を個別に表示する(Biographyのようにセクションごと非表示にはしない)。

## データフロー

1. 管理画面で「イベント登録」→「開催回登録」→「出演登録」の順にデータを積む(それぞれ前段のデータをセレクトで参照するため)。単独公演は`music_event`に直接登録。
2. `/artists/{id}`にアクセスすると、`music_event`と`event_appearance`(→`event_edition`→`event`)をこのアーティストのIDで絞り込んで取得し、Live & Festivalsセクションに表示。

## エラーハンドリング

- 各フォームの必須項目が空 → `redirectWith('error', ...)`(既存パターン踏襲)
- `event_appearance`の`is_headliner`はチェックボックス由来なので未チェック時は`false`として保存(nullにしない)
- 外部キー制約違反(存在しない`event_id`等をUIから送ることは基本無いが、念のため)→ DBエラーとして`redirectWith('error', ...)`

## テスト方針

- 自動テストは追加しない(既存の検証スタイルに合わせる)
- 実装後にPlaywright/curlで実機確認:
  1. `/admin/data`にイベント関連の4フォームが表示されることを確認
  2. イベント→開催回→出演の順に登録し、セレクトの選択肢に前段のデータが正しく反映されることを確認
  3. `music_event`・`event_appearance`を登録したアーティストの`/artists/{id}`にLive & Festivalsセクションが表示され、内容が正しいことを確認
  4. 何も登録していない別アーティストの`/artists/{id}`で、Live & Festivalsセクションが空状態メッセージ付きで表示されることを確認(セクション自体が消えないこと)
