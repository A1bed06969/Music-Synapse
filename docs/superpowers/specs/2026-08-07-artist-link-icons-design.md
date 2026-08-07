# アーティスト外部リンクのアイコン表示 設計

## 背景

アーティスト詳細ページのリンク表示は現在3箇所に分散している: ①ヘッダー内のApple Music/Spotifyボタン(`artist.apple_music_artist_id`/`spotify_artist_id`)、②公式サイト/X/Instagramのテキストリンク(`artist.official_site_url`/`sns_x_url`/`sns_instagram_url`)、③下部のExternal Linksセクション(`artist_external_link`テーブル、MusicBrainz連携で追加、`getLinkLabel()`でホスト名からサービス名のテキストラベルを表示)。

参考画像(yoyn、音楽レビューサイト)の左カラムでは、これらに相当する情報がカテゴリ別(公式・SNS・情報等)にブランドカラーの丸いアイコンボタンとして一覧表示されている。同じような分かりやすさをこのアプリでも実現したい。

## ゴール

- ①②③の3箇所のリンク表示を1つのアイコンブロックに統合する
- 各リンクをブランドカラーの円形アイコンで表示し、カテゴリ(視聴・公式SNS・情報)ごとにグループ化する
- アイコンだけでは分からないサービス名を`aria-label`/`title`で補う

## 非ゴール

- ページ全体を2カラム(yoynのような左固定サイドバー)構成に変更すること。現状の中央1カラムレイアウト(`max-w-3xl`)は維持し、リンク部分の表示方法のみを変更する
- `artist_external_link`や既存カラムのデータ取得ロジック自体の変更(取り込み側であるMusicBrainz連携機能には手を加えない)
- 新しいリンク種別やデータソースの追加

## アーキテクチャ

```
新規: app/components/ArtistLinkIcons.tsx
  - Server Componentとして実装(クライアント状態を持たないため)
  - props: { officialSiteUrl, snsXUrl, snsInstagramUrl, appleMusicArtistId,
             spotifyArtistId, artistName, externalLinks }
  - 3カテゴリ(視聴/公式SNS/情報)に振り分けて、カテゴリごとに
    アイコンボタンの行を描画する。空のカテゴリは非表示。

新規: utils/serviceIcons.ts
  - ホスト名 → simple-icons のアイコンオブジェクト(title/hex/path)の対応表
  - getServiceIcon(hostname: string): { title: string; hex: string; path: string } | null
  - 未知のホストは null を返し、呼び出し側で汎用フォールバックアイコンを使う

変更: app/artists/[id]/page.tsx
  - 現行のヘッダー内リンク行(170-209行目)とExternal Linksセクション
    (213-230行目)を削除し、<ArtistLinkIcons ... /> の呼び出し1つに置き換える

新規依存: simple-icons (個別アイコンを名前付きインポート、ライブラリ全体は
  バンドルしない)
```

## カテゴリ分けとアイコンマッピング

既存データから導出する(新しい列・テーブルは不要):

- **視聴**: `apple_music_artist_id`(Apple Music) / `spotify_artist_id`(Spotify) / `artist_external_link`の`streaming`・`free streaming`・`youtube`・`youtube music`
- **公式・SNS**: `official_site_url`(公式サイト、汎用アイコン) / `sns_x_url`(X) / `sns_instagram_url`(Instagram) / `artist_external_link`の`social network`(Facebook・TikTok等、X/Instagram以外)
- **情報**: `artist_external_link`の`other databases`・`allmusic`・`discogs`・`wikidata`・`IMDb`

`utils/serviceIcons.ts`のホスト名対応表は、既存の`utils/musicbrainz.ts`の`getLinkLabel()`が使っている`DOMAIN_SERVICE_LABEL`と同等の対象範囲(Apple Music/Spotify/Amazon Music/Tidal/Qobuz/AWA/LINE Music/Discogs/AllMusic/Wikidata/IMDb/YouTube/YouTube Music)に加えて、X/Instagram/Facebook/TikTok/公式サイトを含める。各サービス名は`simple-icons`の対応するエクスポート名(`siApplemusic`・`siSpotify`・`siX`・`siInstagram`・`siFacebook`・`siTiktok`等)に手動でマッピングする。

## 表示スタイル

各リンクはブランドカラーの円形バッジ(`simple-icons`の`hex`を背景色、白いアイコングリフ)。ホスト名からサービスを特定できない場合(情報カテゴリの未知の`other databases`等)は、モノクロの汎用外部リンクSVGアイコン(手書き、既存のダークテーマのトーンに合わせた`text-white/60`系)にフォールバックする。公式サイトリンクも同様に汎用アイコン(ブランドではないため)を使う。

各アイコンは`aria-label`と`title`にサービス名(またはURLのホスト名)を設定し、アイコンのみでもクリック前にどのサービスか分かるようにする。

## エラーハンドリング

- カテゴリ内にリンクが1件も無い場合、そのカテゴリを非表示にする。3カテゴリすべて空ならブロック全体を非表示にする(現行の`{externalLinks.length > 0 && ...}`と同じ考え方)。
- `artist_external_link`の`url`が不正でホスト名のパースに失敗した場合(既存の`getLinkLabel()`と同様try/catchで捕捉)、汎用フォールバックアイコンを使う。

## テスト方針

自動テストは追加しない(既存の検証スタイルに合わせる)。実装後に`npx tsc --noEmit`に加え、実機で以下を確認する:

1. King Gnu(視聴・公式SNS・情報の3カテゴリすべてにリンクあり)で、各アイコンが正しいブランドカラー・正しいリンク先で表示されること
2. リンクが1件も無いアーティストで、アイコンブロック自体が表示されないこと
3. 未知のサービス(情報カテゴリの`other databases`等)で汎用フォールバックアイコンが表示されること
4. 各アイコンにマウスオーバーした際、`title`でサービス名が確認できること
