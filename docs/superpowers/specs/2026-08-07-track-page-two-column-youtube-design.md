# トラック詳細ページ 2カラム化 + YouTubeプレーヤー追加 設計

## 背景

トラック詳細ページ(`/tracks/[id]`)には[前回](./2026-08-06-track-streaming-players-design.md)Apple Music・Spotifyの試聴プレーヤーを追加したが、ヘッダーの下に縦一列で並んでおり、紹介文(`track.track_review`)は一番下に離れて表示されている。ユーザーからのフィードバックで、紹介文とプレーヤーを左右2カラムにまとめ、さらにYouTube動画プレーヤー(`track.youtube_video_id`は既に列として存在し、前回の編集フォームで登録可能)を追加してほしいという要望があった。

## ゴール

- ヘッダー下の「紹介文 + プレーヤー」部分を2カラムレイアウトにする(左: 紹介文、右: プレーヤー群)
- YouTube動画プレーヤーを新規追加し、プレーヤーの並び順を YouTube → Apple Music → Spotify にする
- `updateTrack`で`youtube_video_id`欄にフルURLが貼られても、ID部分だけ正規化して保存する(Spotifyで導入済みの仕組みと同じ考え方)

## 非ゴール(今回やらないこと)

- ヘッダー(アートワーク・タイトル・アーティスト名・秒数)自体のレイアウト変更。全幅のまま
- 歌詞リンク・使用楽器・クレジットのレイアウト変更。引き続き全幅で下に並ぶ
- Amazon Music・YouTube Music・Bandcamp・SoundCloud・Tidalのプレーヤー埋め込み(既存プランと同様、IDの登録のみで埋め込み対応は対象外)

## アーキテクチャ

```
utils/format.ts (既存に変更)
  └─ extractYoutubeVideoId: 裸のYouTube動画ID(11文字)もそのまま受け付けるように拡張
     (URLパースを試みる前に、11文字IDパターンへの直接マッチを試す)

app/admin/data/actions.ts (既存に変更)
  └─ updateTrack: youtube_video_id を保存前に extractYoutubeVideoId で正規化

app/tracks/[id]/page.tsx (既存に変更)
  ├─ youtubeSrc を算出(track.youtube_video_id があれば https://www.youtube.com/embed/{id})
  └─ ヘッダー下のプレーヤー部分を2カラム化。紹介文が無ければプレーヤーを全幅表示に切り替え
```

- YouTube埋め込みのiframe構成(`aspect-video`ラッパー・`allow`属性・`title`属性など)は、`app/artists/[id]/page.tsx`の「Latest MV」セクションと同じものを踏襲する。新しい抽象化は導入しない。
- `extractYoutubeVideoId`の拡張は、`extractSpotifyTrackId`が既に採用している「まず裸のID形式にマッチを試みる→ダメならURL形式を試みる」という構造をそのまま踏襲する。

## コンポーネント

### `utils/format.ts` の変更

`extractYoutubeVideoId(url: string): string | null` の先頭に、`isValidId(trimmed)`(既存の`/^[\w-]{11}$/`チェック)を追加し、裸のIDならそのまま返す。マッチしなければ従来通り`new URL()`によるパース処理に進む。既存の呼び出し元(`artist.url_latest_mv`、常にURLが渡される想定)の挙動に変化はない(URLは`isValidId`に一致しないため、従来のURL解析パスに進む)。

### `app/admin/data/actions.ts` の変更

`updateTrack`内の`youtubeVideoId`を、既存の`trim()`後に`extractYoutubeVideoId`へ通してから保存する。空文字の場合は従来通り`null`。

### `app/tracks/[id]/page.tsx` の変更

- `appleMusicSrc`の算出に加えて`youtubeSrc = track.youtube_video_id ? `https://www.youtube.com/embed/${track.youtube_video_id}` : null`を算出
- ヘッダー(アートワーク+タイトルブロック)の直後、現在プレーヤーが単独で並んでいる箇所を、以下のように変更:
  - `track.track_review`がある場合: `grid grid-cols-1 gap-6 sm:grid-cols-2`(左に紹介文の`<p>`、右にプレーヤー群を`space-y-3`で縦に並べる)
  - `track.track_review`が無い場合: 従来通りプレーヤー群のみを全幅(`space-y-3`)で表示。紹介文用の`<p>`(現在ページ最下部にある無条件表示)はこの2カラムブロックに統合されるため、ページ最下部の`{track.track_review && (...)}`は削除する(紹介文の表示箇所が2カラムブロックに一本化される)
  - プレーヤーが1つも無く、かつ紹介文も無い場合は、このブロック自体を非表示にする(現在の`{(appleMusicSrc || track.spotify_track_id) && (...)}`と同様の考え方を、`youtubeSrc`も含めた3条件のORに拡張)
- プレーヤーの並び順: YouTube(`aspect-video`ラッパー) → Apple Music(既存のiframe) → Spotify(既存のiframe)。各々`track.youtube_video_id`/`appleMusicSrc`/`track.spotify_track_id`の有無で個別に非表示。

## データフロー

1. 管理者が編集フォームでYouTube URLまたは動画IDを`youtube_video_id`欄に入力 → `updateTrack`が正規化してDBに保存
2. トラック詳細ページで、紹介文の有無に応じて2カラム or 全幅レイアウトが自動的に切り替わり、登録済みのプレーヤーが上から YouTube → Apple Music → Spotify の順で表示される

## エラーハンドリング

- `youtube_video_id`にYouTube以外のURLや不正な値が入力された場合、`extractYoutubeVideoId`が`null`を返し、保存値は`null`になる(既存の`url_latest_mv`と同じ挙動。フォーム側にエラー表示はしない)
- 紹介文・プレーヤーが全て無い場合はブロック自体を非表示にし、空のグリッド/空白領域を残さない

## テスト方針

- 自動テストは追加しない(既存の検証スタイルに合わせる)
- 実装後に`npx tsc --noEmit`+Playwright/curlで実機確認:
  1. `extractYoutubeVideoId`が裸のID・`youtu.be`URL・`youtube.com/watch?v=`URL・`youtube.com/embed/`URLの全パターンで正しくIDを抽出することを確認(既存の3パターン+新規の裸ID)
  2. 編集フォームからYouTube動画のフルURLを貼り付け保存し、トラックページでYouTubeプレーヤーがAppleMusic/Spotifyより上に表示されることを確認
  3. 紹介文ありのトラックで2カラムレイアウトになることを確認
  4. 紹介文なしのトラックでプレーヤーが全幅表示になることを確認
  5. テストデータは明示的にラベル付けし、検証後にSupabase管理クライアントで元の値(null)に戻す
