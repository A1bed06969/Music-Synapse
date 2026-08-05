# 都道府県ピン地図(パワープレイ&ヘビロテ) 設計

## 背景

`/media/on-air`(パワープレイ&ヘビロテ)には既に月ナビゲーションと局横断のランキング表があるが、ワイヤーフレーム(`media-power-play-wireframe.html`)にあった「日本地図で都道府県ごとの選出局を見る」機能はまだ実装していない。今回はこの部分を設計・実装する。

## ゴール

- 選択中の月に、どの都道府県のメディアがパワープレイ/ヘビロテを行ったかを地図上のピンで一覧できる
- ピンをクリックすると、ページ再読み込みなしでその都道府県のステーション別プッシュ楽曲(局名・楽曲orアルバムorアーティスト・邦楽/洋楽バッジ)を表示できる
- 外部地図ライブラリ・地図APIには依存しない

## 非ゴール(今回やらないこと)

- 緯度経度に基づく正確な地理描画(あくまでデフォルメ配置)
- メディアの編集フォーム(既存メディアの都道府県を後から直す一般的なUI)。今回はFM802のみ手動SQLで`大阪府`を設定済み。今後の新規メディアは追加する登録フォームの都道府県セレクトで対応する
- 地図のズーム・パン等のインタラクション
- NOW LIVEモード/ROOTSモード/GENRE REGIONSモードなど、トップページ側の「MUSIC PLANET」世界地図(これは別スコープ)

## データの前提

- `media.prefecture`(text, nullable)に都道府県名(例:「大阪府」)を入れる。既存のFM802は本設計着手時に`大阪府`を設定済み。
- 今後登録するメディアは、管理画面(`/admin/data`)の「メディアを追加」フォームに追加する都道府県セレクト(47件)で入力する。

## アーキテクチャ

```
/media/on-air/page.tsx (Server Component)
  ├─ 月ナビ・現在の月を決定(既存ロジックを流用)
  ├─ 選択中の月の radio_rotation を media_program→media(prefecture) 込みで取得
  │    (ランキング集計用に既に取っている monthRows のjoinを流用・拡張)
  ├─ 都道府県ごとにグルーピングして PrefectureMapData[] を構築(サーバー側)
  ├─ <PrefectureMap prefectureData={...} />  ← 新規クライアントコンポーネント
  ├─ ランキング表(既存)
  └─ エントリ一覧 + フィルター(既存、地図の選択とは独立)
```

- 地図の選択状態はクライアントの`useState`のみで完結させる(サーバーへの追加リクエストは発生しない)。集計は全てサーバー側で計算し、propsとして丸ごと渡す。
- 相関図(`RelationGraph`)と同じ役割分担: 「サーバーで集計 → クライアントで表示切り替えのみ担当」。

## コンポーネント

### `utils/prefectures.ts` (新規)

47都道府県の概略座標(viewBox 0〜100基準、デフォルメ配置)を持つ静的定数のみ。ロジックは持たない。

```ts
export type PrefectureCoord = { name: string; x: number; y: number }
export const PREFECTURE_COORDS: PrefectureCoord[] = [
  { name: '北海道', x: 78, y: 8 },
  { name: '青森県', x: 70, y: 18 },
  // ... 47件
]
```

### `app/components/PrefectureMap.tsx` (新規, `'use client'`)

Props:

```ts
type PrefectureEntry = {
  stationName: string
  targetLabel: string
  targetHref: string | null
  musicType: 'DOMESTIC' | 'OVERSEAS'
}
type PrefectureMapData = {
  prefecture: string
  mediaCount: number
  entries: PrefectureEntry[]
}

function PrefectureMap({ data }: { data: PrefectureMapData[] })
```

挙動:

- `PREFECTURE_COORDS`をループしてSVGを描画。`data`に該当エントリがある県のみピン(丸 + 件数バッジ)を表示。データがない県は非表示(ワイヤーフレーム通り)。
- ピンクリックで`selectedPref`ステートを更新。選択中のピンをハイライト表示。
- 選択中の都道府県があれば、地図の下にステーション別カード一覧を表示(局名・対象タイトルへのリンク・邦楽/洋楽バッジ)。
- データが空(`data.length === 0`)の場合はピンなしの地図のみ表示(エラーにはしない)。

### `/media/on-air/page.tsx` の変更

- 既存の`monthRows`クエリ(ランキング集計用)に`media:media_id(prefecture)`を追加。
- 都道府県ごとにグルーピングする処理を追加し、`PrefectureMapData[]`を組み立てて`<PrefectureMap>`に渡す。
- 配置順序: 月ナビ → **地図(新規)** → ランキング表 → エントリ一覧+フィルター。
- 地図の選択状態は「エントリ一覧」セクションの局/邦楽・洋楽フィルターとは独立(互いに影響しない)。

### `/admin/data` の変更

- 「メディアを追加」フォーム(`createMedia`)に都道府県セレクト(47件、`utils/prefectures.ts`の名前リストを再利用)を追加。
- `actions.ts`の`createMedia`に`prefecture`フィールドを渡すよう変更。

## データフロー

1. ユーザーが`/media/on-air?month=2026-08`にアクセス
2. サーバーが該当月の`radio_rotation`を`media_program → media(id, name, prefecture)`込みで取得
3. サーバーで都道府県ごとにグルーピング(局数・エントリ一覧)
4. `PrefectureMap`にpropsとして渡す
5. クライアントでピンをクリック → ローカルstateのみ更新 → 該当都道府県のカードを表示

## エラーハンドリング

- 該当月にデータが0件 → ピンなしの地図を表示(既存の「まだオンエアデータが登録されていません」という空状態と共存)
- `media.prefecture`が未設定のメディアのエントリ → 地図には出さない(集計時にスキップ)。件数の食い違いに気づけるよう、必要なら合計値とランキング表の合計を目視で見比べる程度に留める(自動アラートは作らない)

## テスト方針

- 自動テストは追加しない(このプロジェクトの既存の検証スタイルに合わせる)
- 実装後にPlaywrightで実機確認:
  1. `/media/on-air`にアクセスし地図にFM802(大阪府)のピンが表示されることを確認
  2. ピンをクリックしてステーションカードが表示されることを確認(ページ遷移なし)
  3. カード内のリンクからトラック詳細ページに遷移できることを確認
  4. 管理画面の新しい都道府県セレクトから新規メディアを登録できることを確認
