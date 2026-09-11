# アルバム・トラック詳細ページ 3カラム化 設計書

## 背景

2026-09-09の改修(`docs/superpowers/specs/2026-09-09-artist-knowledge-interface-design.md`)で、アーティスト詳細ページを「LEFT固定/CENTER独立スクロール/RIGHT固定」の3カラムシェルに全面刷新した。同スペックは明示的に「アルバム・トラック詳細ページのレイアウト変更は対象外」としていたが、本改修はこれを覆し、アルバム・トラックページにも同じ「テイスト」の3カラム構成を導入する。

アルバム・トラックページは現在、2026-09-08の改修(`docs/superpowers/specs/2026-09-08-detail-pages-redesign-design.md`)で導入した「雑誌見開き」型の2カラム(`DetailHeader`横並び + `VisualSlot`見開き)を使っている。アーティストページと異なり、アルバム・トラックは扱う情報のドメインが薄く(9セクションのような大きなコンテンツ群を持たない)、セクションごとに実ルートを割る必要はない。そのためアーティストページの「RIGHT=ページ内ナビゲーション」ではなく、**RIGHT=関連・副次コンテンツ**という別の3カラム解釈を採用する(ユーザーとの協議で確定)。

## ゴール

- アルバム・トラック詳細ページに、アーティストページと同じ視覚的テイスト(LEFT/RIGHT固定・独立スクロール、CENTERだけが伸びる、フッターはCENTERの中だけ)を導入する
- LEFT=識別情報(ジャケット・タイトル・視聴リンク・メタ情報・紹介文)、CENTER=そのページの主コンテンツ、RIGHT=関連・副次コンテンツ、という役割分担にする
- 既存Supabaseの実データのみを使用する。新規データや空のプレースホルダーは作らない
- アルバム・トラック共通の3カラムシェルを1つの新規コンポーネントとして切り出し、両ページで共有する

## 非ゴール(v1スコープ外)

- アーティスト詳細ページ(`app/artists/[id]/layout.tsx`)への変更・リファクタリング。既に本番稼働している実装には触れない。新規シェルは別コンポーネントとして作る(コードの重複は許容する)
- セクションごとの実ルート分割(`/albums/[id]/tracks`等)。アルバム・トラックは1ページ完結のまま
- Tablet専用ブレークポイントの個別最適化(アーティストページと同方針。Desktop 3カラム・Mobile 1カラムの間はCSSの自然なフォールバックに任せる)
- モバイルレイアウトの大幅な再設計。現行の縦積み構成を踏襲し、カラム順序(LEFT→CENTER→RIGHT)で並べる

## レイアウト設計

### Desktop(3カラム)

```
┌────────────────────────────────────────────────────────────┐
│ GLOBAL HEADER (SiteHeader, 既存)                              │
├──────────────────┬────────────────────────┬─────────────────┤
│  LEFT (固定)      │ CENTER (独立スクロール)  │ RIGHT (固定)     │
│  識別情報          │ 主コンテンツ             │ 関連・副次コンテンツ │
└──────────────────┴────────────────────────┴─────────────────┘
```

- アーティストページ(`app/artists/[id]/layout.tsx`)で確立した`--shell-h: calc(100vh - 57px)`パターンをそのまま流用する。LEFT/RIGHTは`lg:h-[var(--shell-h)] lg:overflow-y-auto lg:shrink-0`、CENTERは`lg:flex-1 lg:overflow-y-auto`、フッター(`SiteFooter`)はCENTERの中の最後にだけ描画する
- 初期値としてLEFT=32%・RIGHT=26%(min-width付き、CENTERはflex-1)を仮の目標値とする。アーティストページの40:40:20が実測に基づき38:flex-1:18へ調整された前例があるため、本実装でも各カラムの実コンテンツ幅を測定した上で最終値を調整してよい(仕様上の可変値として明記しておく)
- ページ全体の最大幅制約(`max-w-[1600px]`)は撤廃し、シェル自体をビューポート全幅で使う(アーティストページと同様)

### Mobile(1カラム)

現行の縦積み構成を維持しつつ、カラムの役割分担だけを新構成に合わせる:

```
1. LEFT相当(識別情報): ジャケット・タイトル・視聴リンク・メタ情報・紹介文
2. CENTER相当: 主コンテンツ
3. RIGHT相当: 関連・副次コンテンツ
4. SiteFooter
```

- `StickyMiniHeader`(スマホでヘッダー行がスクロールアウトした時の縮小バー)は既存のまま流用する

## 共通コンポーネント: `DetailPageShell`

新規: `app/components/detail/DetailPageShell.tsx`

```ts
export default function DetailPageShell({
  left,
  center,
  right,
}: {
  left: React.ReactNode
  center: React.ReactNode
  right: React.ReactNode
})
```

- アーティストページの`layout.tsx`のデスクトップ/モバイル分岐JSX(`--artist-shell-h`パターン、`lg:overflow-y-auto`、フッターの置き場所)をアルバム・トラック向けに一般化したもの。`ArtistSectionCounts`や`ArtistNav`のようなナビゲーション概念は持たない、純粋なレイアウト用コンポーネント
- `left`/`center`/`right`はそれぞれのページ(`app/albums/[id]/page.tsx`、`app/tracks/[id]/page.tsx`)が組み立てたJSXをそのまま渡す。データ取得は各ページ側の責務のまま変えない
- `SiteFooter`はこのコンポーネントの内部で、CENTERの末尾に1回だけ描画する
- アーティストページの`layout.tsx`は変更しない。このコンポーネントを使うのはアルバム・トラックページのみ

## `VisualSlot` / `hasVisualContent` の廃止

現行、紹介文とMVを「見開きの左カラム」としてまとめて出す役割を持っていたが、本改修で紹介文はLEFT、MVはCENTER(ページごとに扱いが異なる)に分離されるため、この組み合わせ自体が不要になる。`app/components/detail/VisualSlot.tsx`を削除し、MV埋め込み用のiframeマークアップは各ページの新規コンポーネント側にインライン化する(ロジックを持ち回す価値がなくなったため、共通化を維持しない)。

## アルバムページ

### LEFT: `AlbumIdentityPanel`(新規)

- ジャケット画像(`album.jacket_url`、正方形、クロップなし。アーティストページの画像方針を踏襲)
- タイトル(`album.title`)・アーティスト名(複数可、リンク付き)
- メタ情報: 種別(`ALBUM_TYPE_LABEL_JA`)・発売日・レーベル・トラック数・フォーマット・Streaming Status(現行`DetailHeader`の`metaLine`相当の内容をそのまま移設)
- 視聴リンク: 既存`ListenLinks`コンポーネントをそのまま使用(Apple Music/Spotify/YouTube Music/Amazon Music/TOWER RECORDS/Discogs等)
- 紹介文: `album.album_review`(既存`VisualSlot`が持っていた「紹介」見出し+本文をそのままLEFTのテキストブロックとして表示。データが無ければ非表示)

### CENTER: タブ切替(新規コンポーネント `AlbumCenterTabs`)

- タブ1「収録曲」(デフォルト): 現行の収録曲リストJSX(ディスク分割・トラック番号・タイトル・再生時間・`PreviewButton`)をそのまま移設
- タブ2「MV」: このアルバムに属するトラックのうち`youtube_video_id`を持つものをサムネイルグリッドで表示。サムネイルは`https://i.ytimg.com/vi/{youtube_video_id}/hqdefault.jpg`(Overview画面で確立済みのフォールバックパターンと同じ)。クリックしたサムネイルはその場で`<iframe>`埋め込みに切り替わる(別タブ・モーダルは使わない、既存の`ArtistLinkIcons`の「その場で展開」パターンに寄せる)。並び順は`disc_number`→`track_no`昇順(`representative_track_id`があれば先頭に出す)
- アルバム収録曲に1件も`youtube_video_id`が無ければ「MV」タブ自体を表示しない(タブ1のみになる)
- データ取得: 既存の`tracks`クエリに`youtube_video_id`カラムを追加するだけで済む(新規テーブル・新規JOIN不要)

### RIGHT: 関連・副次コンテンツ

1. **掲載ディスクガイド** — 現行の`discGuideSelections`セクションをそのまま移設
2. **キュレーション・ランキング選出** — 現行`DetailHeader`の`rankings`サイドバー(`CurationTags`使用)をここに統合
3. **パワープレイ選出** — 新規取得。`radio_rotation`を`album_id`で取得(Overview画面の「byAlbum」クエリと同じ形。`select('id, period_start_date, music_type, media_program:media_program_id(program_name, media:media_id(name))').eq('album_id', id).order('period_start_date', {ascending:false})`)。表示は既存`RotationModal`をそのまま流用する(「ほか全国N局」の折りたたみ含め、トラックページと同一の見た目にする)
4. **他の作品・その他のバージョン** — 現行の`otherWorks`セクションと`otherVersions`セクションをそのまま移設(2つの棚として並べる)

## トラックページ

### LEFT: `TrackIdentityPanel`(新規)

- ジャケット画像(`album.jacket_url`、アルバム経由。トラック自体はジャケットを持たないため既存動作を踏襲)
- タイトル(`track.title`)・アーティスト名(複数可、リンク付き)・所属アルバムへのリンク
- メタ情報: 再生時間(`formatDuration`)
- 視聴リンク: 既存`ListenLinks`をそのまま使用(歌詞リンクの`extraLinks`含む)
- 紹介文: `track.track_review`(現行`VisualSlot`の「紹介」見出し+本文をLEFTへ移設)

### CENTER: タブなし、縦積み(新規コンポーネント `TrackCenterContent`)

1. **MV** — `track.youtube_video_id`があれば先頭に埋め込み表示。無ければこのブロックごと非表示(トラックページはタブを持たないため、アルバムページのMVタブのような「他候補一覧」は無い)
2. **他の曲** — 現行の`siblingTracks`セクション(このアルバムの他トラック一覧)をそのまま移設
3. **使用楽器** — 現行の`instrumentGroups`セクションをそのまま移設
4. **クレジット** — 現行の`creditGroups`セクション(`<details>`の折りたたみUIを含め)をそのまま移設

### RIGHT: 関連・副次コンテンツ

1. **パワープレイローテーション** — 現行`RotationModal`(`rotations`)をそのまま移設
2. **タイアップ実績** — 現行の`syncEntries`セクションをそのまま移設
3. **キュレーション・ランキング選出** — 現行`DetailHeader`の`rankings`サイドバー(`CurationTags`)をここに統合

## ページ共通の扱い

- `BackLink`・(トラックページのみ)編集リンク・成功/エラーバナーは、シェルの外(LEFTの先頭、または`DetailPageShell`より前)に既存位置のまま残す。3カラム化の対象はコンテンツ本体のみ
- `StickyMiniHeader`は既存のまま(監視対象IDをLEFTの先頭要素に付け替える)

## ビジュアル言語

アーティストページと統一する。新規トーンは導入しない(背景・ボーダー・テキスト色は既存Tailwindトークンをそのまま使う)。

## パフォーマンス方針

- アルバムページの新規クエリはパワープレイ選出用の`radio_rotation`(`album_id`条件)1本のみ。既存の`Promise.all`に追加する形で、直列化を増やさない
- トラックページはデータ取得を変更しない(既存の`Promise.all`のセクション分けをそのままRIGHT/CENTERの表示先に振り分けるだけ)
- 画像は既存の`<img>`+object-fit運用を踏襲する(next/image化はしない)

## テスト方針

- 既存の2改修(2026-09-08、2026-09-09)と同様、Headless Chrome(Puppeteer-core)による実ブラウザ確認を実装後に行う
- 確認項目: PC(LEFT/RIGHTが独立スクロールでCENTERだけ伸びること、フッターがCENTERの中だけに出ること、アルバムページのMVタブ切替、トラックページのMV有無分岐)、Mobile(縦積みの順序、視聴リンクの折り返し)
- MVが1件も無いアルバム・トラックでの空状態表示(アルバム: MVタブ非表示、トラック: MVブロック非表示)
- ディスクガイド・キュレーション・パワープレイ・他の作品のいずれも0件のアルバムでRIGHTが破綻しないこと(既存の「0件なら静かに非表示」方針を踏襲)
