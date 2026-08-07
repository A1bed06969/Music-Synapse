# MusicBrainz連携(外部リンク・ジャンル収集) 設計

## 背景

アーティストの外部リンク集(公式サイト・SNS・各種配信/情報サイト)とジャンルタグを、MusicBrainzから収集して反映したい。MusicBrainzは認証不要(User-Agent必須、1req/秒のレート制限)で、アーティスト検索・外部リンク(url-rels)・ジャンル(genres)を取得できることを実データ(King Gnu, MBID `338f5d97-3133-4bf8-a58e-068ff9b5405d`)で確認済み。King Gnuの例では38件の外部リンク(official homepage / social network / streaming / free streaming / other databases / purchase for download / purchase for mail-order / lyrics / youtube / youtube music / songkick / vgmdb 等)と、ジャンル`j-pop`・`pop rock`が取得できた。

Spotify連携(アーティスト画像収集)はAPIが所有者アカウントのPremium加入を要求することが判明し断念。今回はMusicBrainz連携を先に進める。

## ゴール

- アーティスト編集ページからMusicBrainzでそのアーティストを検索し、候補を確認した上で外部リンク・ジャンルタグを取り込めるようにする
- 取り込んだ外部リンクをアーティスト詳細ページに表示する
- ジャンルタグは既存の`genre`/`artist_genre`テーブルと統合する(重複させない)

## 非ゴール(今回やらないこと)

- 全アーティスト一括実行(アーティストごとに個別実行)
- 通販サイト群(purchase for download / purchase for mail-order)・歌詞サイト(lyrics)・songkick・vgmdbなどニッチなリンク種別の取り込み(主要な種別に絞る)
- MusicBrainzの"tags"(ユーザー投稿タグ、genresより粒度が細かいもの)の取り込み。今回は"genres"(MusicBrainzが正式なジャンル分類として管理している値)のみ対象とする
- 既存の`official_site_url`・`sns_x_url`・`sns_instagram_url`が既に手動設定されている場合の上書き(iTunesバルク登録の再取込みで確立した「手動編集は上書きしない」方針を踏襲)

## データの前提(実APIで確認済み)

- 検索: `GET https://musicbrainz.org/ws/2/artist?query={name}&fmt=json&limit=5`。認証不要、`User-Agent`ヘッダー必須。結果は`score`(一致度)・`name`・`country`・`type`(Group/Person等)・`life-span.begin`を含む
- 詳細取得: `GET https://musicbrainz.org/ws/2/artist/{mbid}?inc=url-rels+genres&fmt=json`。`relations`配列(各要素`type`・`url.resource`)と`genres`配列(各要素`name`・`count`)を返す
- レート制限: 1リクエスト/秒。連続呼び出し時は`utils/itunes.ts`の`sleep(400)`と同様の待機処理が必要
- `genre`テーブルに`name`のUNIQUE制約は無いため、新規作成前に既存行を検索して重複作成を避ける必要がある

## アーキテクチャ

```
migration: create table artist_external_link (
  id text primary key default generate_ms_id('AEL'),
  artist_id text not null references artist(id),
  link_type text not null,
  url text not null,
  created_at timestamptz not null default now()
)

utils/musicbrainz.ts (新規)
  ├─ searchArtist(name: string): Promise<{mbid, name, country, type, beginYear}[]>
  └─ fetchArtistDetails(mbid: string): Promise<{
       links: { type: string; url: string }[]  // ALLOWED_LINK_TYPESでフィルタ済み
       officialHomepage: string | null
       twitterUrl: string | null
       instagramUrl: string | null
       genres: string[]
     }>
     (url-relsの中から official homepage / social network[+ホスト名でX・Instagramを判別] を
      専用フィールドに、それ以外の許可リストに載っている種別をlinksに振り分ける)

app/admin/data/artists/[id]/musicbrainz/page.tsx (新規)
  └─ ?mbid= が無ければ: 名前で検索した候補一覧(ラジオボタン、国・種別・生年表示)
     ?mbid= があれば: fetchArtistDetailsの結果をプレビュー表示 + 「取り込む」ボタン

app/admin/data/artists/[id]/musicbrainz/actions.ts (新規)
  └─ importMusicBrainzData(formData): 選択されたmbidから再度fetchArtistDetailsし、
     ① official_site_url/sns_x_url/sns_instagram_url が空なら埋める
     ② links を artist_external_link に挿入
     ③ genres それぞれについて、genre.nameが既存になければ作成し、artist_genreで紐付け

app/artists/[id]/page.tsx (既存に変更)
  └─ 外部リンクセクションを追加(artist_external_link をlink_typeごとにグループ表示)

app/admin/data/artists/[id]/edit/page.tsx (既存に変更)
  └─ 「MusicBrainzで検索」リンクを追加
```

## コンポーネント

### `utils/musicbrainz.ts`(新規)

- 許可するリンク種別(定数): `streaming`, `free streaming`, `social network`(ただしX/Instagramと判定できたものは専用フィールドへ、それ以外はlinksへ), `other databases`, `youtube`, `youtube music`
- `official homepage`は`officialHomepage`専用フィールドへ(linksには入れない)
- `searchArtist`・`fetchArtistDetails`とも呼び出し前に`sleep(400)`を挟む(レート制限対策)

### `app/admin/data/artists/[id]/musicbrainz/page.tsx`(新規)

- 検索段階: アーティスト名で`searchArtist`を実行し、上位5件をラジオボタン一覧(名前・国・種別・生年)で表示。「この候補で詳細を見る」的な導線で`?mbid=`付きの同ページへ遷移
- プレビュー段階: `fetchArtistDetails`の結果を表示(公式サイト・X・Instagramの有無、リンク一覧、ジャンル一覧)。「取り込む」ボタンで`importMusicBrainzData`を実行

### `importMusicBrainzData`(新規サーバーアクション)

- 対象アーティストの現在の`official_site_url`等を取得し、空の項目だけMusicBrainzの値で埋める
- `links`を`artist_external_link`に挿入(同じ`artist_id`+`link_type`+`url`の重複を避けるため、挿入前に既存行を確認)
- `genres`それぞれについて、`genre`テーブルを`name`で検索し無ければ`createGenre`相当の処理で作成、`artist_genre`に`upsert`で紐付け

### `app/artists/[id]/page.tsx`の変更

- 新しいセクションで`artist_external_link`を`link_type`ごとにグループ化して表示(リンクテキストは`link_type`の日本語ラベル、遷移先は`url`)

## データフロー

1. 管理者がアーティスト編集ページから「MusicBrainzで検索」を押す
2. 名前で検索された候補から正しいアーティストを選ぶ
3. 取り込み内容(リンク・ジャンル)をプレビューで確認し、「取り込む」を押す
4. 外部リンクは新規テーブルに、ジャンルは既存のgenre/artist_genreに反映され、アーティスト詳細ページに表示される

## エラーハンドリング

- 検索結果が0件の場合、「該当するアーティストが見つかりませんでした。」を表示
- 詳細取得に失敗した場合、「MusicBrainzからの取得に失敗しました。」を表示し、取り込みボタンは表示しない
- 既に取り込み済みの同一リンク(artist_id+link_type+url)は再取り込み時に重複挿入しない

## テスト方針

- 自動テストは追加しない(既存の検証スタイルに合わせる)
- 実装後にPlaywrightで実機確認:
  1. King Gnuで検索し、候補一覧に正しい候補(国:JP、生年:2013)が表示されることを確認
  2. 候補を選んでプレビューに正しいリンク・ジャンルが表示されることを確認
  3. 取り込み後、`artist_external_link`・`artist_genre`・`genre`に正しく反映されることを確認
  4. アーティスト詳細ページに外部リンクセクションが表示されることを確認
  5. 既に`official_site_url`等が手動設定されているアーティストで、取り込み後もその値が変わらないことを確認
