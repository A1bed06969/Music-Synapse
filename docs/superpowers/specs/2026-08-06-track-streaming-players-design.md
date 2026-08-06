# トラック詳細ページの試聴プレーヤー + トラック編集フォーム 設計

## 背景

`track`テーブルには配信サービスIDの列(`apple_music_track_id`は全1834件に値あり、`spotify_track_id`など他の配信ID列は現在0件)が既に存在するが、トラック詳細ページ(`/tracks/[id]`)には試聴プレーヤーが無い。`apple_music_track_id`はiTunes取込パイプラインで自動的に埋まるが、`spotify_track_id`などは登録する手段がまだ無いため、あわせて登録できるようにする。

## ゴール

- `/tracks/[id]`に、Apple MusicとSpotifyの試聴プレーヤーを埋め込む(データがある場合のみ表示)
- `spotify_track_id`をはじめとする配信ID・その他メタデータを編集できる管理画面フォームを新設する

## 非ゴール(今回やらないこと)

- Spotify APIとの自動連携・自動ID取得(手動入力のみ)
- `apple_music_track_id`の編集(iTunes取込の照合キーのため、アーティスト編集フォームの`apple_music_artist_id`と同じ扱いで対象外)
- Amazon Music・YouTube Music・Bandcamp・SoundCloud・Tidalの実際のプレーヤー埋め込み(今回はIDの登録フォームのみ。埋め込み対応は今回はApple Music・Spotifyの2つのみ)
- `/admin/data`へのトラック一覧セクション追加(1834件あり一覧表示は非現実的なため、公開ページ側にリンクを置く方式にする)

## データの前提

- `track.apple_music_track_id`: 1834/1834件に値あり
- `album.apple_music_album_id`: 387/387件に値あり(Apple Music埋め込みURL構築に必要)
- `track.spotify_track_id`ほか配信ID列: 現在0件。今回追加する編集フォームで手動登録する
- iTunes取込は`country=JP`でAPIを呼んでいる(`utils/itunes.ts`)ため、Apple Music埋め込みのstorefrontは`jp`に統一する

## アーキテクチャ

```
app/admin/data/actions.ts (既存に追記)
  └─ updateTrack(formData): 11項目を更新するサーバーアクション。updateArtistと同じパターン。

app/admin/data/tracks/[id]/edit/page.tsx (新規)
  └─ トラック編集フォーム。app/admin/data/artists/[id]/edit/page.tsxと同じ構造。

app/tracks/[id]/page.tsx (既存に変更)
  ├─ 「編集」リンクを追加(/admin/data/tracks/{id}/edit へ)
  └─ 「試聴」セクションを追加: Apple Music / Spotify の iframe埋め込み(データがある方のみ表示)
```

- 読み取りクエリに`album.apple_music_album_id`と`track.spotify_track_id`を追加取得する。
- `updateTrack`は既存の`updateArtist`と同じ設計原則(`createAdminClient()`・空文字→null・`revalidatePath`)を踏襲する。新しい抽象化は導入しない。

## コンポーネント

### `app/admin/data/actions.ts` の変更

`updateTrack(formData)`を追加。フィールド: `track_id`(hidden, 必須) / `spotify_track_id` / `amazon_music_track_id` / `youtube_music_track_id` / `bandcamp_track_id` / `soundcloud_track_id` / `tidal_track_id` / `youtube_video_id` / `lyric_url` / `isrc` / `bpm`(数値、空文字→null) / `track_review`。全て空文字は`null`に変換。成功時に`revalidatePath('/tracks/${trackId}')`。

### `app/admin/data/tracks/[id]/edit/page.tsx`(新規)

`app/admin/data/artists/[id]/edit/page.tsx`と同じ構造: トラックをidで1件取得(`notFound()`ガード)、11項目の入力フォームを`updateTrack`に送信。トラックタイトル・アーティスト名を編集不可の見出しとして表示。

### `app/tracks/[id]/page.tsx`の変更

- 既存クエリに`album:album_id(id, title, jacket_url, apple_music_album_id)`と`spotify_track_id`を追加
- ヘッダー付近に小さな「編集」テキストリンク(`/admin/data/tracks/{id}/edit`)を追加
- タイトル直下に「試聴」セクションを追加:
  - Apple Music: `track.apple_music_track_id && album?.apple_music_album_id`のとき、`https://embed.music.apple.com/jp/album/{slug}/{albumId}?i={trackId}`を`<iframe>`で埋め込む(`slug`はトラックタイトルをURLエンコードしたもので代用)
  - Spotify: `track.spotify_track_id`があるとき、`https://open.spotify.com/embed/track/{id}?utm_source=generator`を`<iframe>`で埋め込む
  - どちらも無ければ「試聴」セクション自体を非表示(空状態メッセージは出さない)

## データフロー

1. 管理者が`/tracks/{id}`の「編集」リンクから`/admin/data/tracks/{id}/edit`に入り、Spotify等のIDを登録
2. `/tracks/{id}`に戻ると試聴プレーヤーが表示される

## エラーハンドリング

- 存在しないトラックID → 既存通り`notFound()`
- 各配信IDが未設定 → 該当プレーヤーを表示しない(エラー表示はしない)
- `bpm`は数値変換に失敗した場合(空文字以外の不正値が来ることは想定しないが念のため)`Number.isNaN`チェックを行い、`NaN`ならnullとして保存

## テスト方針

- 自動テストは追加しない(既存の検証スタイルに合わせる)
- 実装後にPlaywright/curlで実機確認:
  1. Apple Music IDが揃っているトラック(実データ)で、Apple Musicプレーヤーが表示されることを確認
  2. 編集フォームからSpotify IDをテスト値で登録し(実在するSpotifyトラックIDを使い、明示的にテストである旨をtrack_review欄などに残さない — DBの実データを汚さないよう、検証後に元の値(null)へ戻す)、詳細ページにSpotifyプレーヤーが表示されることを確認
  3. どちらのIDも無いトラックで「試聴」セクション自体が表示されないことを確認
  4. 「編集」リンクから編集フォームに遷移でき、保存後に`/tracks/{id}`へ反映されることを確認
