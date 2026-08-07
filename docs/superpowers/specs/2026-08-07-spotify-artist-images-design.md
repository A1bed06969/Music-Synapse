# Spotify連携によるアーティスト画像収集 設計

## 背景

アーティスト画像(`artist.image_url`)は現在18件中17件が未設定。当初Last.fm APIでの画像収集を検討したが、Last.fmは2018年頃から画像配信元との契約上の問題で実際のアーティスト画像を提供しておらず、`artist.getInfo`は全アーティスト共通のプレースホルダー画像しか返さないことが実際のAPIドキュメント・2026年3月時点のサポートコミュニティの報告から確認できた。代わりにSpotify Web APIを使う。

## ゴール

- `/admin/data`に、`image_url`未設定の全アーティストをまとめてSpotifyで検索し、候補画像を確認・選択して保存できる画面を追加する
- 選択したアーティストの`image_url`と`spotify_artist_id`(既存カラム、現在1/18件のみ埋まっている)を更新する

## 非ゴール(今回やらないこと)

- 既に`image_url`が設定済みのアーティストの再検索・差し替え(今回は未設定分のみ)
- トラック・アルバム単位の画像収集(アーティスト画像のみ)
- Spotifyのジャンル情報の取り込み(検索結果にはgenresも含まれるが、MusicBrainz連携で別途扱う想定のため今回は使わない)
- ユーザー認可が必要なSpotify機能(プレイリスト操作等)。Client Credentials方式(サーバー間認証のみ)で完結する範囲に限定する

## 事前準備(実装前にユーザー側で必要な作業)

- [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)で無料アプリを作成し、Client ID・Client Secretを取得
- `.env.local`に`SPOTIFY_CLIENT_ID`・`SPOTIFY_CLIENT_SECRET`(`NEXT_PUBLIC_`プレフィックスなし、サーバー専用シークレット)を追加

## データの前提(公式ドキュメントで確認済み)

- 認証: `POST https://accounts.spotify.com/api/token`、`grant_type=client_credentials`、`Authorization: Basic base64(client_id:client_secret)`、`Content-Type: application/x-www-form-urlencoded`。レスポンスの`access_token`は`expires_in`(通常3600秒)有効。
- 検索: `GET https://api.spotify.com/v1/search?q={name}&type=artist&limit=5`。各アーティストオブジェクトは`id`(Spotify Artist ID)・`name`・`images`(`{url, width, height}[]`、幅の降順)・`genres`・`popularity`を含む。`images`が空配列のアーティストも存在しうる。

## アーキテクチャ

```
utils/spotify.ts (新規)
  ├─ getAccessToken(): アクセストークンをメモリ内キャッシュ(有効期限まで使い回す)しつつ取得
  └─ searchArtistImages(name: string): Promise<{spotifyArtistId, name, imageUrl, popularity}[]>
     検索結果から images[0](最大サイズ)をimageUrlとして、画像が無い候補は除外して返す(上位5件)

app/admin/data/artist-images/page.tsx (新規)
  └─ image_url が null のアーティストを取得 → searchArtistImages
     → アーティストごとにラジオボタン(候補サムネイル画像+名前+人気度 / デフォルト「登録しない」)

app/admin/data/artist-images/actions.ts (新規)
  └─ saveSelectedArtistImages: 選択されたSpotify Artist IDについて、対象アーティストの
     image_url と spotify_artist_id を更新する

app/admin/data/page.tsx (既存に変更)
  └─ 「画像を取得」リンクを追加(/admin/data/artist-imagesへ)
```

- コラボアーティスト発見機能([2026-08-07](../plans/2026-08-07-collaborator-artist-discovery.md))と同じ設計原則(検索→人間の確認→保存、既存の更新ロジック以外は増やさない)を踏襲する。画像はサムネイル表示そのものが確認手段になるため、コラボ機能のような「Apple Musicで見る」リンクは不要。

## コンポーネント

### `utils/spotify.ts`(新規)

- `getAccessToken(): Promise<string>` — モジュールスコープの変数にトークンと有効期限を保持し、期限切れなら再取得する
- `searchArtistImages(name: string): Promise<{ spotifyArtistId: string; name: string; imageUrl: string; popularity: number }[]>` — 検索APIを呼び、`images`が空の候補を除外し、`images[0].url`(最大サイズ)を使って整形して返す

### `app/admin/data/artist-images/page.tsx`(新規)

- `image_url is null`のアーティストを取得。0件なら「未設定のアーティストはありません。」を表示して終了
- 各アーティストについて`searchArtistImages`を呼ぶ(コラボ機能と同様、個別に`try/catch`で失敗を分離し、失敗した名前はまとめて表示する)
- アーティストごとにラジオボタングループ: 各候補は`<img>`サムネイル+アーティスト名+人気度、デフォルト選択は「登録しない」
- 候補が0件だったアーティストは選択フォームから除外し、下部にまとめて表示する

### `saveSelectedArtistImages`(新規サーバーアクション)

- 選択された(アーティストDB ID → Spotify Artist ID)の組を集める
- それぞれについて、対応する候補の`imageUrl`を検索結果から引き直す必要はなく、フォームの隠しフィールドとして画像URLも一緒に送信し、`artist`テーブルの`image_url`・`spotify_artist_id`を更新する
- 0件選択時はエラーメッセージを表示して一覧に戻す。更新後は件数を成功メッセージとして表示する

### `app/admin/data/page.tsx`の変更

- 既存のアーティストセクション付近に「画像を取得」リンクを追加

## データフロー

1. 管理者が`/admin/data`の「画像を取得」から一覧画面に入る
2. 画面がSpotifyで全未設定アーティストを検索し、候補画像を並べて表示
3. 管理者が画像を見て、正しいものを選択(または「登録しない」のまま)して送信
4. 選択されたぶんだけ`image_url`・`spotify_artist_id`が更新される

## エラーハンドリング

- Spotifyの認証(トークン取得)に失敗した場合、ページ全体で「Spotify APIへの接続に失敗しました。」を表示する
- 個々のアーティストの検索が失敗した場合、そのアーティストだけ「検索に失敗した名前」としてまとめ、他のアーティストの処理は続行する(コラボ機能と同じパターン)
- 保存が一部失敗した場合、成功件数と失敗件数を分けてメッセージに表示する

## テスト方針

- 自動テストは追加しない(既存の検証スタイルに合わせる)
- 実装後にPlaywrightで実機確認:
  1. 「画像を取得」リンクから一覧画面に遷移し、複数アーティストの候補画像が表示されることを確認
  2. 1件選んで保存し、`artist.image_url`・`spotify_artist_id`が正しく更新されることを確認(実データへの反映のため、誤った画像を選ばないよう事前に候補を目視確認してから選択する)
  3. トークンキャッシュが機能していること(同一実行内で複数アーティストを検索してもトークン取得が1回だけであること)をログ等で確認
