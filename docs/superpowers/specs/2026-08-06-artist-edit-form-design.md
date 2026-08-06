# アーティスト編集フォーム 設計

## 背景

`artist`テーブルのプロフィール項目(bio, url_latest_mv, spotify_artist_id 等)は現在iTunes一括登録経由でしか値が入らず、手動での追記・修正はSupabaseに直接SQLを打つしかない。今回、都道府県ピン地図・アーティスト詳細ページの実装を経て、実際に表示へ使われているのにデータが空の項目が多いことが分かった。この機会に管理画面(`/admin/data`)に簡易な編集フォームを追加し、データ拡充を手動でも進められるようにする。

## ゴール

- `/admin/data` にアーティスト一覧(名前+編集リンク)を追加する
- `/admin/data/artists/[id]/edit` に、アプリ内で実際に表示へ使われている14項目を編集できる専用フォームを追加する
- 送信すると`artist`テーブルを更新し、`/admin/data`に成功/エラーメッセージ付きでリダイレクトする
- `streaming_status`を「配信あり/なし」の2値に定義し直す(DBのCHECK制約含む)
- `origin_prefecture`は都道府県セレクトではなく自由テキストにする(海外アーティストに対応するため)

## 非ゴール(今回やらないこと)

- `name`・`apple_music_artist_id`の編集(iTunes一括登録の照合キーであり、手動編集すると再インポート時の突合が壊れるため対象外)
- `active_status`・`biography_status`・`hometown_country`・`hometown_latitude`・`hometown_longitude`・各種ストリーミングID(`amazon_music_artist_id`等、`apple_music_artist_id`以外)など、現在アプリ内のどこにも表示に使っていない項目の編集(表示されていない項目を編集できるようにしても確認しようがないため)
- アーティストの新規作成フォーム(既存通りiTunes一括登録のみ)
- 画像アップロード(`image_url`は既存の`jacket_url`等と同様、外部URLをテキストで貼るだけ)
- ページネーション・検索(現状5件のみなので一覧はシンプルな全件表示でよい)

## データの前提

- `artist_streaming_status_check`というCHECK制約が既に存在し、`streaming_status`を`all`/`physical_only`/`partial`に制限している(`pg_constraint`で確認済み)。2値化にはこの制約の張り替えが必要。
- `origin_prefecture`にはCHECK制約が存在しない(`pg_constraint`で確認済み)ため、自由テキスト化はアプリ側のフォーム変更のみで済む。
- 現在5アーティストとも`streaming_status`・`origin_prefecture`は全てNULLなので、値の移行(マイグレーションによるデータ書き換え)は不要。制約の定義変更のみ。
- マイグレーションはSupabase MCPの`apply_migration`ツールで直接実行できる(今回のセッションから利用可能になった)。

## アーキテクチャ

```
/admin/data/page.tsx (既存, Server Component)
  └─ 新規セクション「アーティスト」: 既存の`artists`一覧(id, name)を使い、
     各行に「編集」リンク → /admin/data/artists/${id}/edit

/admin/data/artists/[id]/edit/page.tsx (新規, Server Component)
  ├─ 対象artistをselect('*')で取得。存在しなければnotFound()
  ├─ 14項目の入力欄を持つ<form action={updateArtist}>
  │   各欄はartistの現在値をdefaultValueに設定(空ならプレースホルダーのみ)
  └─ 送信後は updateArtist アクションがリダイレクトを担当

app/admin/data/actions.ts (既存ファイルに追記)
  └─ updateArtist(formData): 14項目を読み取り、空文字はnullに変換して
     .update().eq('id', artistId)。成功/失敗どちらも/admin/dataへredirectWith
```

- 既存の`createLabel`等のサーバーアクションと同じパターン(`createAdminClient()`・空文字→null・`redirectWith`)を踏襲する。
- 一覧ページ(`/admin/data`)自体のレイアウトや他セクション(ジャンル・相関図・レーベル等)には手を入れない。新セクションを追加するのみ。

## コンポーネント

### `/admin/data/page.tsx` の変更

- 既存の`artists`(id, name)取得はそのまま流用。
- 新規セクション「アーティスト」を、既存の各セクション(ジャンル・相関図データ・レーベル…)と同じ`<section className="mt-10 border-t border-white/10 pt-8">`パターンで先頭に追加。
- 各行: `{artist.name}` + `<Link href={`/admin/data/artists/${artist.id}/edit`}>編集 →</Link>`。

### `/admin/data/artists/[id]/edit/page.tsx` (新規)

- `params: Promise<{ id: string }>`から`id`を取得し、`supabase.from('artist').select('*').eq('id', id).single()`。存在しなければ`notFound()`。
- フォーム項目(全て任意入力、`inputClass`/`buttonClass`は`/admin/data/page.tsx`と同じスタイル定数を踏襲):
  - `bio`: `<textarea>`
  - `name_kana`, `name_en`, `hometown_city`, `origin_prefecture`, `official_site_url`, `sns_x_url`, `sns_instagram_url`, `image_url`, `spotify_artist_id`, `url_latest_mv`: `<input type="text">`(URL系は`type="url"`でも可)
  - `formed_year`: `<input type="number">`
  - `artist_type`: `<select>` (空/ソロ/バンド/ユニット、既存`ARTIST_TYPE_LABEL`を再利用)
  - `streaming_status`: `<select>` (空/あり/なし、新しい2値)
  - 各`defaultValue`は取得したartistの現在値(nullなら空文字)
- `<Link href="/admin/data">← 管理画面に戻る</Link>`をページ上部に配置(他の`[id]`ページと同じ導線)。

### `app/admin/data/actions.ts` の変更

- `updateArtist(formData: FormData)`を追加。
- `artist_id`をhiddenフィールドから受け取り、14項目を`String(formData.get(...) ?? '').trim()`で読み取る。
- テキスト系は空文字→`null`。`formed_year`は空文字→`null`、それ以外は`Number(...)`。
- `.from('artist').update({...}).eq('id', artistId)`。
- 成功時: `revalidatePath('/admin/data')` + `revalidatePath('/artists/${artistId}')` (詳細ページのキャッシュも更新) + `redirectWith('success', 'アーティスト情報を更新しました。')`。
- 失敗時: `redirectWith('error', `更新に失敗しました: ${error.message}`)`。

### `utils/format.ts` の変更

- `ARTIST_STREAMING_STATUS_LABEL`を`{ all: '全解禁確定', physical_only: 'フィジカルのみ', partial: '一部限定配信' }`から`{ available: 'あり', none: 'なし' }`に置き換える。
- `/artists/[id]/page.tsx`側の表示コード(`配信: {ARTIST_STREAMING_STATUS_LABEL[artist.streaming_status]}`)は変更不要(キーが変わるだけで参照方法は同じ)。

### DBマイグレーション

```sql
alter table artist drop constraint artist_streaming_status_check;
alter table artist add constraint artist_streaming_status_check
  check (streaming_status = any (array['available'::text, 'none'::text]));
```

Supabase MCPの`apply_migration`(project_id: `ftvhglfthbcxhgnoninv`)で直接実行する。

## データフロー

1. `/admin/data`のアーティスト一覧から「編集」をクリック
2. `/admin/data/artists/{id}/edit`が対象artistを取得し、現在値入りのフォームを表示
3. フィールドを編集して送信 → `updateArtist`が14項目をUPDATE
4. `/admin/data`に成功メッセージ付きでリダイレクト。以後`/artists/{id}`でも新しい値が反映される

## エラーハンドリング

- 存在しない`id`で編集ページにアクセス → `notFound()`(既存の`/artists/[id]`等と同じ挙動)
- 全項目任意入力のため、必須バリデーションは無し
- `formed_year`に数値以外が入力された場合 → `Number('abc')`は`NaN`になるため、`Number.isNaN`チェックを入れて不正なら`null`として保存する(エラーで弾かず、フォーム全体の送信は通す)
- DB更新失敗(制約違反等) → `redirectWith('error', ...)`でメッセージ表示、値は保存されない

## テスト方針

- 自動テストは追加しない(既存の検証スタイルに合わせる)
- 実装後にPlaywright/curlで実機確認:
  1. `/admin/data`にアーティスト一覧と編集リンクが表示されることを確認
  2. 既存アーティストの編集ページで現在値(既に設定済みの`apple_music_artist_id`等、編集対象外の項目も含め表示崩れがないか)が正しく表示されることを確認
  3. 14項目のうちいくつかを更新して送信し、`/admin/data`にリダイレクトして成功メッセージが出ることを確認
  4. `/artists/{id}`で更新内容(特にbio・url_latest_mv・spotify_artist_id・streaming_statusの新しい表示)が反映されていることを確認
  5. `streaming_status`を「あり」「なし」それぞれで保存できることを確認(マイグレーション後の制約が正しく機能しているか)
