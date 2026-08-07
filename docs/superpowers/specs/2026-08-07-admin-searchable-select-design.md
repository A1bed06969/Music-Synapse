# 管理画面 トラック・アルバム選択の検索可能コンボボックス化 設計

## 背景

`/admin/data`の各種登録フォームには、トラック(現在約1993件)・アルバム(387件)を選ぶ素の`<select>`が複数箇所にある。トラック件数が多すぎて、素の`<select>`のスクロールでは選びたいトラックを見つけられない状態になっている。

## ゴール

- トラック選択の3箇所(ラジオローテーション・ランキングエントリー・シンクエントリー)を、テキスト検索で絞り込める入力に置き換える
- アルバム選択の3箇所(レーベル紐付け・ラジオローテーション・ランキングエントリー)も同様に置き換える
- 6箇所すべてで同じ汎用コンポーネントを再利用する

## 非ゴール(今回やらないこと)

- アーティスト選択(11件)の変更。件数が少なく素の`<select>`のままで問題ない
- サーバーサイド検索(APIラウンドトリップ)。トラック・アルバムとも全件をブラウザ側に持たせ、クライアント側で即時フィルタする方式にする
- 新規外部ライブラリの導入。既存のReact `useState`のみで実装する
- 選択必須項目(シンクエントリーのトラック、レーベル紐付けのアルバム)へのクライアント側バリデーション追加。既存のサーバー側バリデーション(未選択ならエラーredirect)をそのまま使う

## データの前提

- `trackOptions`は`id, title, artist:artist_id(name)`を取得済み(`app/admin/data/page.tsx`)
- `albumOptions`も`id, title, artist:artist_id(name)`を取得済み。ただし現在、3箇所中1箇所(レーベル紐付け)のみアーティスト名を表示しており、残り2箇所(ラジオローテーション・ランキングエントリー)はタイトルのみ表示している。データは既に取得済みのため、クエリ変更は不要
- トラック約1993件・アルバム387件を`{id, label}`形式でクライアントに渡す。ページのHTML初期ペイロードが増える(概算10〜15万バイト程度)が、ローカル運用の管理画面であり実用上問題ない想定

## アーキテクチャ

```
app/admin/data/SearchableSelect.tsx (新規、'use client')
  └─ 汎用の検索可能コンボボックス。データ形状に依存しない。

app/admin/data/page.tsx (既存に変更)
  ├─ trackPickerItems = trackOptions.map(t => ({ id: t.id, label: `${t.title}${artist ? ' — ' + artist.name : ''}` })) を1回だけ算出
  ├─ albumPickerItems = albumOptions.map(a => ({ id: a.id, label: `${a.title}${artist ? ' — ' + artist.name : ''}` })) を1回だけ算出(アーティスト名を6箇所すべてで統一表示)
  └─ 6箇所の <select name="track_id" .../> <select name="album_id" .../> を
     <SearchableSelect items={trackPickerItems} name="track_id" placeholder="..." />
     <SearchableSelect items={albumPickerItems} name="album_id" placeholder="..." />
     に置き換える
```

- `trackPickerItems`/`albumPickerItems`はそれぞれ1回だけ算出し、同じ配列参照を3箇所の`<SearchableSelect>`に渡す(Next.jsのRSCシリアライズが同一参照を重複送信しないため、データ転送量は「1回分×2種類」で済む)。
- 各フォームの他の項目(番組選択・企画選択・作品選択・順位・日付など)は変更しない。

## コンポーネント

### `app/admin/data/SearchableSelect.tsx`(新規)

```
Props:
  items: { id: string; label: string }[]
  name: string        — 送信されるフォームフィールド名
  placeholder: string — 未選択時に入力欄に表示するプレースホルダー
```

- 内部state: `query`(検索文字列)、`selectedId`(選択中のid、初期値null)、`open`(候補ドロップダウンの表示有無)
- `<input type="hidden" name={name} value={selectedId ?? ''} />` を常に描画し、外側の`<form action={...}>`が送信するときにこの値がPOSTされる(既存の`<select name="track_id">`と全く同じ役割)
- 未選択時: 見た目上のテキスト`<input>`は編集可能。入力するたびに`items`を`label`の部分一致(大文字小文字を区別しない)でフィルタし、最大20件をドロップダウンに表示する。候補をクリックすると`selectedId`を確定し、入力欄の表示テキストをそのラベルに変え、ドロップダウンを閉じる
- 選択済み時: 入力欄に選択中のラベルを表示し、隣に「×」ボタンを表示。クリックで`selectedId`を`null`に戻し、検索状態に戻る
- キーボード: ドロップダウン表示中にEnterでフィルタ結果の先頭候補を選択、Escapeでドロップダウンを閉じる(選択はしない)
- ドロップダウンを閉じるタイミング: 入力欄からフォーカスが外れたとき(候補クリックのイベントが先に処理されるよう、`onBlur`に短い遅延を入れる)
- スタイリング: 既存の`inputClass`相当の見た目(`border-white/15 bg-white/5`等)をテキスト入力に、ドロップダウンは`absolute`配置の暗背景パネル(`border-white/15 bg-black rounded-md shadow-lg max-h-64 overflow-y-auto`)

### `app/admin/data/page.tsx`の変更

- 上記2つの`Item[]`算出を追加
- 6箇所の`<select>`ブロックを`<SearchableSelect>`に置き換え。プレースホルダーは既存の各`<option>`文言を踏襲する(例: 「(トラック指定なし)」「トラックを選択」など、フィールドが任意か必須かに応じて使い分ける)

## データフロー

1. `/admin/data`読み込み時、サーバー側で`trackPickerItems`/`albumPickerItems`を算出しHTMLに埋め込む
2. 管理者がテキストを入力 → クライアント側で即座に候補を絞り込み表示(サーバー通信なし)
3. 候補を選ぶと隠しフィールドに値がセットされ、既存のフォーム送信・サーバーアクションはそのまま動作する

## エラーハンドリング

- 必須項目が未選択のまま送信された場合、既存のサーバー側バリデーション(`redirectWith('error', ...)`)がそのまま働く。変更なし
- 候補が0件の場合、ドロップダウンに「該当なし」の旨を表示する

## テスト方針

- 自動テストは追加しない(既存の検証スタイルに合わせる)
- 実装後にPlaywrightで実機確認:
  1. トラック検索でタイトルの一部を入力し、候補が絞り込まれ、クリックで選択できることを確認
  2. 選択後、フォームを送信して該当のサーバーアクションが正しいtrack_id/album_idを受け取ることを確認(実データで登録→内容確認→削除、既存の検証データ運用に従う)
  3. 「×」で選択解除できることを確認
  4. アルバム側でも同様に確認し、6箇所すべてでアーティスト名が表示されることを確認
  5. 必須項目(シンクエントリーのトラック等)を未選択のまま送信し、既存のエラーメッセージが表示されることを確認
