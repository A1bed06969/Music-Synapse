# アーティスト詳細ページ 再構築 設計

## 背景

現行の `/artists/[id]` は、ヘッダー(画像・名前・タグ・リンク)・bio・アルバムグリッドのみのシンプルな構成。デザインコンセプト(`artist-detail-design-concept.html`)で示された「Latest MV」「Discography(横スクロール)」「Relation Graph ミニプレビュー」を取り入れて再構築する。

デザインコンセプトは配色・フォントも含めて現行アプリと大きく異なるライト・ペーパー調だが、今回は**構造とセクション構成のみ**を採用し、色・フォントは既存のダークテーマ(黒背景・白文字)を維持する。アプリ全体の配色統一を崩さないため。

## ゴール

- ヘッダーにサブスク導線(Apple Music / Spotify)とSNS導線を整理して表示する
- `bio`をセクション区切り付きで表示する(既存データ、表示のみ変更)
- アルバム一覧を横スクロールの固定幅カード列に変更する
- アーティストごとに1本、YouTube MVを埋め込み表示できるようにする(値が無ければセクションごと非表示)
- ページ下部に、そのアーティストを中心にした相関図の**実際に動くミニプレビュー**を埋め込み、全画面版へのリンクを添える

## 非ゴール(今回やらないこと)

- Live Info(ライブ公演情報)・Festival Appearances(フェス出演歴)・Chronology(年表クロノロジー)の実装。いずれも現行スキーマに対応テーブルが無く、新規テーブル設計・管理画面CRUDが必要になるため別スペックとする
- デザインコンセプトの配色・フォント(ペーパー地に明朝体+アンバー/ペトロール)の適用。アプリ全体のトーン統一のため、既存ダークテーマを維持する
- アーティスト編集用の管理画面(新規追加する`url_latest_mv`はSupabaseに直接入力する運用とし、管理画面フォームは作らない)
- ヘッダーの相関図への簡易リンクは末尾のRelation Graphセクションに統合するため削除する(導線の重複を避ける)
- モックアップのパンくず(「MUSIC PLANET › ARTIST ROOTS › ...」)は現行ナビに存在しない概念のため採用しない。既存の「← 検索に戻る」リンクを維持する

## データの前提

- `artist`テーブルに新規列 `url_latest_mv`(text, nullable)を追加する。既存の`url_facebook` / `url_youtube` / `url_songkick`と同じ命名規則に合わせる。
- 値の入力は、他のプロフィール項目(bio, official_site_url等)と同様、Supabaseに直接行う運用とする(今回は管理画面を作らない)。
- Apple Music / Spotifyボタンは既存の`spotify_artist_id` / `apple_music_artist_id`から組み立てる。値が無いボタンは非表示。
  - Spotify: `https://open.spotify.com/artist/{spotify_artist_id}`
  - Apple Music: `https://music.apple.com/jp/artist/{encodeURIComponent(artist.name)}/{apple_music_artist_id}`(Appleは実際にはIDで解決するため、slug部分の文字列自体はリダイレクトに影響しない)

## アーキテクチャ

```
/artists/[id]/page.tsx (Server Component)
  ├─ artist, albums を取得(既存クエリのまま)
  ├─ 相関図プレビュー用に nodes/edges を取得(/artists/[id]/relations と同じ取得ロジックをこのページにも実装)
  ├─ ヘッダー(既存の情報 + サブスク行 + SNS行に整理、相関図リンクは削除)
  ├─ Biography(既存bio、セクション区切りのみ追加)
  ├─ Discography(横スクロール行に変更、データは既存のまま)
  ├─ Latest MV(url_latest_mvがある場合のみ表示)
  └─ Relation Graph(既存<RelationGraph>を小さめの固定高さコンテナに埋め込み + 全画面リンク)
```

- 新規クライアントコンポーネントは作らない。既存の`RelationGraph`はSVGが`viewBox`基準で自動縮小されるため、コンテナの高さを小さく指定するだけでミニプレビューとして再利用できる(コンポーネント自体の改修は不要)。
- 相関図データ取得ロジック(`artist_relation`→対象アーティスト取得→`artist_genre`でカテゴリ付与)は`/artists/[id]/relations/page.tsx`にある実装をこのページ用にも実行する(同じ取得パターンをここでも用いるだけで、共通化のための抽象化は行わない。2箇所だけの重複であり、無理に共通ヘルパー化するとどちらの呼び出し元にも合わせにくい抽象になるため)。

## コンポーネント

### `app/artists/[id]/page.tsx` の変更

- ヘッダー部分:
  - サブスク行: `spotify_artist_id` / `apple_music_artist_id`があるものだけボタン表示。スタイルは既存の`/media/on-air`の「絞り込む」ボタン等と同系統(`rounded-md border border-white/15 px-3 py-1.5 text-xs hover:bg-white/5`)。ラベルは「▶ Apple Music」「▶ Spotify」。
  - SNS行: 既存の official_site_url / sns_x_url / sns_instagram_url のリンクをそのまま移動(スタイル変更なし)
  - 相関図への「🔗 相関図を見る」リンクは削除(末尾セクションに統合するため)
- セクション区切り: 小さいローカルコンポーネント(このファイル内、export不要)として用意する。「丸(4px, bg-white/40)+ 横線(flex-1, border-white/10)+ ラベル(text-xs uppercase tracking-wide text-white/40)」の並びをflexで組む。新規ファイルには切り出さない(このページでしか使わないため)。
- Biography: 既存の`{artist.bio && <p>...}`をセクション区切りの下に配置(内容・条件は変更なし)
- Discography: 現行の`grid grid-cols-2 sm:grid-cols-4`を`flex gap-4 overflow-x-auto pb-2`+固定幅カード(`flex-shrink-0 w-28`、ジャケットは`aspect-square`のまま)に変更。カード内のリンク・ホバー時のscale等は既存の見た目を踏襲。データ取得・空状態メッセージは既存のまま。
- Latest MV: `artist.url_latest_mv`がある場合のみ、YouTube watch URL / youtu.be 短縮URLの両方から動画IDを抽出し、`https://www.youtube.com/embed/{videoId}`を`aspect-video`の`<iframe>`で埋め込む。値が無ければセクションごとレンダリングしない。
- Relation Graph: `/artists/[id]/relations/page.tsx`と同じデータ取得(`artist_relation` → 相手アーティスト取得 → `artist_genre`でカテゴリ付与)をこのページのサーバーコンポーネント内でも行い、`<div className="h-56 overflow-hidden rounded-lg border ...">`程度の固定高さコンテナの中に既存の`<RelationGraph nodes={} edges={} centerId={artist.id} />`をそのまま描画。下に「相関図を全画面で見る →」リンク(`/artists/${artist.id}/relations`)。

### マイグレーション

- `artist`テーブルに `url_latest_mv text null` を追加するSQLをSupabase側で実行する(Supabase MCPのexecute_sqlツールが使えればそれで、無ければユーザーに直接実行してもらう)。

## データフロー

1. ユーザーが`/artists/{id}`にアクセス
2. サーバーが`artist`・`album`(既存)に加えて、相関図用の`artist_relation`/相手`artist`/`artist_genre`を取得
3. ヘッダー・Biography・Discography・Latest MV・Relation Graphプレビューをサーバーでレンダリング
4. Relation Graphプレビューはクライアント側(`RelationGraph`内部)でd3-forceのシミュレーションが走り、ドラッグやノードクリックでの`/artists/{id}`遷移も小さいプレビューのまま動作する(既存コンポーネントの挙動をそのまま継承)

## エラーハンドリング

- `url_latest_mv`が未設定 → Latest MVセクション自体を表示しない(空埋め込みや「未登録」メッセージは出さない。他の任意項目と同じ扱い)
- `url_latest_mv`の形式が想定外(watch URL/youtu.be以外)で動画IDを抽出できない → セクションを表示しない(壊れた埋め込みを出さない)
- 相関図データが0件(relationsが無いアーティスト) → 既存の`RelationGraph`の空状態(「まだ相関データがありません。」)がそのままミニプレビュー内に表示される

## テスト方針

- 自動テストは追加しない(既存の検証スタイルに合わせる)
- 実装後にPlaywrightで実機確認:
  1. `url_latest_mv`が設定されたアーティストで、MVセクションにiframeが表示されることを確認
  2. `url_latest_mv`が未設定のアーティストで、MVセクションが表示されないことを確認
  3. Discographyが横スクロールできることを確認
  4. Relation Graphのミニプレビューが表示され、「全画面で見る」リンクで既存の`/artists/{id}/relations`に遷移できることを確認
  5. `npx tsc --noEmit`がクリーンであることを確認
