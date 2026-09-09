# アーティスト詳細ページ「Artist Knowledge Interface」再設計 設計書

## 背景

2026-09-08に実施した詳細ページ改修(`docs/superpowers/specs/2026-09-08-detail-pages-redesign-design.md`)で、アーティスト/アルバム/トラックの3ページに「雑誌見開き」型の2カラムレイアウトを導入し、本番稼働している。しかし、縦長に情報を並べるだけの構成では「Artistのプロフィールを見るページ」の域を出ず、Music Synapseが持つ関連情報(ディスコグラフィ、年表、フェス出演、人物相関、メディア掲載、ランキング入り、受賞歴、ラジオオンエア実績)を横断的に掘っていく体験になっていない。

本改修は、アーティスト詳細ページに限定して、2カラム版を**完全に置き換える**。アルバム・トラックページの2カラムレイアウトは対象外(現状維持)。

## ゴール

- アーティスト詳細ページを「プロフィールページ」から「Artistを起点に音楽情報を掘っていくデータベースインターフェース」に変える
- PCではLEFT(40%: Artist Identity・固定)/ CENTER(40%: コンテンツ・スクロール)/ RIGHT(20%: ナビゲーション・固定)の3カラム構成
- 9つのコンテンツセクション(Overview / Discography / Timeline / Festival & Live / Network / Media / Ranking / Awards / Radio Rotation)を、それぞれ実URLとして持つ
- 既存Supabaseの実データのみを使用する。ダミーデータ・空のプレースホルダーを作らない
- 音楽メディア×エディトリアルデザイン×データベースを融合した、Spotify(ストリーミングUI)にもDiscogs(無機質なDB UI)にも寄せない独自のトーン

## 非ゴール(v1スコープ外)

- **Related Artists(似ているアーティスト)** — SIMILAR SOUND/SAME SCENE/INFLUENCESを判定するデータ・ロジックが存在しないため、v1では実装しない(ナビゲーションにも出さない)。将来、類似度アルゴリズムを設計する際に別タスクとして再検討する。
- **Music Profile**(Biographyとは別の「音楽的特徴」短文) — 該当データが存在しないため実装しない。LEFTカラムのテキストはBiographyのみ。
- **Sound / Mood Tag**(MELLOW, PIANO, SOULFUL等の独自タグ) — 該当データが存在しないため実装しない。表示するのは既存の`artist_genre`によるジャンルのみ。
- アルバム・トラック詳細ページのレイアウト変更(対象外、現状の2カラムのまま)
- リリースを持たないメンバー個別ページ(`MemberProfile.tsx`、`page_override='member'`または自身名義のリリースが無いアーティスト)のレイアウト変更。前回改修時と同様、今回も対象外として現状維持する。
- Tablet専用ブレークポイントの個別最適化(Desktop 3カラム・Mobile 1カラムの間は、CSSの自然なフォールバックに任せる。専用のTablet UIは設計しない)

## レイアウト設計

### Desktop(3カラム、40:40:20)

```
┌────────────────────────────────────────────────────────────┐
│ GLOBAL HEADER (SiteHeader, 既存)                              │
├──────────────────────┬──────────────────────┬───────────────┤
│  LEFT (40%, sticky)  │ CENTER (40%, scroll) │ RIGHT (20%, sticky) │
│  Artist Identity     │ Content (9セクション)  │ Navigation     │
└──────────────────────┴──────────────────────┴───────────────┘
```

- `grid-template-columns: minmax(280px, 4fr) minmax(320px, 4fr) minmax(180px, 2fr)`。視覚比率は常に40:40:20を維持し、各カラムに最小幅を設定して極端な引き伸ばしを防ぐ
- ページ全体の最大幅は`max-w-[1600px] mx-auto`(既存デザインの慣習と統一)
- LEFT・RIGHTは`sticky`。ブラウザ全体のスクロールロックは行わない(通常のページスクロールのまま、CENTERの中身が伸び縮みしてもLEFT/RIGHTは画面内に留まる)
- 適用ブレークポイントは`lg:`(既存の詳細ページ群と同じ基準)。それ未満はMobile版

### Mobile(1カラム)

Desktopの空間構造(LEFT→CENTER→RIGHT)をそのまま縦積みにしない。情報構造を組み替える:

```
1. Artist Identity(コンパクト版)
2. Compact Navigation(2列グリッド)
3. Content(選択中のセクション)
```

- Artist Identityはデスクトップ版より情報を絞る(画像・名前・国/活動年・ジャンル・外部リンク・Biography抜粋)
- Navigationは縦1列の長いリストにしない。**2列グリッド**を基本とし、9項目なら5行程度に収める。大きなカードUIにせず、Number・Label・Countのみのコンパクトな行にする
- Navigation全体を画面上部に固定しない(Content表示領域を圧迫しないため)。Identity→Navigation→Contentの自然な縦スクロールとする
- Discographyのグリッドは2列(既存/albumsページの狭幅グリッドと同じ考え方)

## URLとルーティング設計

「選択中のセクションがURLに反映され、ブラウザの戻る/進むに対応し、セクション切り替えのたびにページ最上部へ強制スクロールしない」という要件を、クライアント側のタブ状態ではなく**Next.js App Routerの実ルート**で満たす。

```
app/artists/[id]/
  layout.tsx          # LEFT(Artist Identity, sticky) + RIGHT(Navigation, sticky) を描画。
                       # {children} が CENTER に入る。アーティスト基本情報(識別情報・
                       # リンク・Biography・ジャンル・9項目分のカウント)はここで1回だけ取得する。
  page.tsx             # Overview(セクション未指定時のデフォルト)
  discography/page.tsx # Discography
  timeline/page.tsx    # Timeline (既存の独立ページ /artists/[id]/timeline を統合・置き換え)
  live/page.tsx        # Festival & Live
  network/page.tsx     # Artist Network
  media/page.tsx       # Media
  ranking/page.tsx     # Ranking
  awards/page.tsx      # Awards
  radio/page.tsx       # Radio Rotation
```

- LEFT/RIGHTは`layout.tsx`が持つため、セクション間のクライアント遷移では再取得・再マウントされない(Next.jsの標準動作)。CENTER部分の`page.tsx`だけが差し替わる
- RIGHTのナビゲーション項目は`usePathname()`で現在のセクションを判定し、アクティブ状態(アクセントライン)を出す
- 各`page.tsx`は自分のセクションに必要なデータだけを取得する(後述のパフォーマンス方針)
- メンバー個別ページ(`page_override='member'`等)は`layout.tsx`の冒頭で判定し、非対象なら現行の`MemberProfile`をそのまま描画して以降のセクションルートには到達させない

## LEFTカラム: Artist Identity

- **Artist Image**: 丸型アバターをやめ、LEFT幅いっぱいの大きな画像(aspect-square または 4:5)。`artist.image_url`が無ければ空欄(現行のVisualSlot同様、代替アートワークやモザイクは作らない)
- **基本情報**: アーティスト名(`name`)・かな/英語表記(`name_kana`/`name_en`)・出身地(`origin_prefecture`/`hometown_city`/`hometown_country`)・活動年(`formed_year`〜`disbanded_year`または現在)。存在する項目のみ表示
- **ジャンル**: `artist_genre`→`genre.name`。既存の詳細ページと同じ取得方法。5〜8個程度を上限に表示(超過分は省略、既存の他ページでの慣習に合わせる)
- **外部リンク**: 既存の`ArtistLinkIcons`コンポーネントをそのまま使用(Primary/Secondaryの区別・favicon fallback含め、変更不要)
- **Biography**: `artist.bio`。初期表示5〜8行程度に`line-clamp`し、「Read More」で全文展開(新規の折りたたみUI、既存にパターンなし)

## RIGHTカラム: Navigation

Editorial Index形式(Number・Label・Countのみ、大きなボタンにしない)。アクティブ項目はアクセントラインで表現。

| # | セクション | カウントの取得元 |
|---|---|---|
| 01 | OVERVIEW | (カウントなし) |
| 02 | DISCOGRAPHY | アーティストのアルバム件数(既存`buildArtistAlbumQuery`と同じ集合) |
| 03 | TIMELINE | タイムライン項目数(後述) |
| 04 | FESTIVAL & LIVE | `buildArtistAppearanceQuery`の件数 |
| 05 | NETWORK | `artist_relation`(membership/production)の件数 |
| 06 | MEDIA | `findRelatedNews`によるニュース関連付け件数 |
| 07 | RANKING | `ranking_entry`(直接+アルバム/トラック経由)の件数 |
| 08 | AWARDS | `award_entry`(直接+アルバム/トラック経由)の件数 |
| 09 | RADIO ROTATION | `fetchArtistMediaSelections`(`radio_rotation`ベース)の件数 |

カウントは`layout.tsx`で1回だけ取得し、Navigationとレイアウト全体で共有する(各セクションページが個別に数え直さない)。

## CENTERカラム: セクション別設計

### 01. Overview(デフォルト表示)

各項目をプレビュー表示(全件は出さない、詳細は該当セクションへの遷移で見る):

1. **Latest Release** — 最新アルバム1件をアートワーク中心に大きく表示(タイトル・発売日・種別・Streaming Status)
2. **Popular Tracks** — 「代表曲」(既存のロジックを流用: ランキング掲載・ラジオローテーション実績で重み付けした上位5曲)
3. **Recent Activity** — 直近のTimeline項目数件
4. **Upcoming Live** — `buildArtistAppearanceQuery`のうち未来日程のみ数件
5. **Latest Media** — ニュース関連付け・メディア選出の直近数件
6. **Featured Content** — 直近のRanking/Awards掲載があれば1〜2件

### 02. Discography

- CENTER幅(40%)の中を**3列グリッド**に分割する(4列にも2列にもしない。Mobileのみ2列)。ページ全体ではなくCENTERの中だけで完結させる
- カード: アートワーク→タイトル→発売日→種別→レーベル名→Streaming Status
- 上部にFilter: 種別(ALL/ALBUMS/EP/SINGLES/COMPILATIONS/LIVE、既存`ALBUM_TYPE_LABEL_JA`の分類を使用)、配信状況(既存`STREAMING_STATUS_LABEL`の分類を使用)。横スクロール可能なコンパクトな見た目
- 作品数が多い場合は3列×N行を縦スクロール。ページネーションを採用する(既存の`/albums`一覧で確立した60件単位のページングパターンに合わせる。Infinite Scrollは新規パターンになるため採用しない)

### 03. Timeline

既存`ArtistTimeline`コンポーネントのロジックをそのまま移設して使う(リリース・フェス・受賞等を年ごとにグルーピングする既存実装)。対象イベント種別は現状の実装を踏襲する。項目クリックで該当詳細ページへ遷移(既存動作を維持)。

### 04. Festival & Live

既存`buildArtistAppearanceQuery`を使用。Upcoming/Pastの切り替えタブを追加(現状の実装は日付降順の一覧のみなので新規UI)。表示項目: 日付・イベント名・会場・都市/国・種別。

### 05. Artist Network

- データ源は`artist_relation`(このアーティストが`artist_id_a`または`artist_id_b`側の行、membership/production)
- 可視化は既存の`RelationGraph`コンポーネント(`app/relations/page.tsx`で使用中の汎用ノード/エッジグラフ)を、このアーティスト起点のデータに絞って再利用する
- Mobileではグラフの代わりにリスト/グループ表示に切り替える(既存`RelationGraph`はグラフ専用のため、Mobile向けの簡易リスト表示を新規に用意する)
- 「誰と、なぜつながっているか」が分かることを優先し、円形ネットワーク図の派手さそのものは目的にしない

### 06. Media

既存の`findRelatedNews`(アーティスト名でのニュースタイトル一致)によるニュース記事のEditorial List。日付・媒体・タイトル。(`fetchArtistMediaSelections`は名称に反してニュースではなくラジオのパワープレイ等選出データを返すユーティリティであり、09. Radio Rotationのデータ源として使う。実装調査で判明し、本スペックはこの対応に修正済み)

### 07. Ranking

`ranking_entry`をこのアーティスト起点で取得(直接の`artist_id`、またはアルバム/トラック経由)。年・ランキング名・順位のリスト。

### 08. Awards

`award_entry`(このアーティストの`artist_id`、または関連アルバム/トラック経由)。年・アワード名・カテゴリ・結果のリスト。

### 09. Radio Rotation

`fetchArtistMediaSelections`(既存、`radio_rotation`をtrack/album/artist直接指定の3方向から合算するユーティリティ)。日付・局名・番組・曲名のリスト。

## Streaming Status の扱い

Discographyの各カードで、既存`STREAMING_STATUS_LABEL`の分類(配信中/配信終了・非公開/未解禁等)を「補足情報」ではなく主要メタデータとして明示する。バッジの意匠は既存パターン(アイコン+ラベル)を踏襲する。

## ビジュアル言語

- 背景: `#080808`〜`#0C0C0C`、サーフェス: `#111111`〜`#151515`、ボーダー: `#252525`、主要テキスト: `#F5F5F5`、副次テキスト: `#999999`。既存サイトのダーク基調(`bg-[#0a0a0a]`等)とほぼ同系統のため、既存のTailwindトークンとの整合を実装時に確認する
- タイポグラフィで情報階層を作る(アーティスト名=大、セクション見出し=中、メタデータ=小、ナビゲーション=小+letter-spacing)。過剰に巨大な文字は使わない
- カード化はArtwork系コンテンツ(Discography)のみ。Timeline/Media/Ranking/Awards/Radio RotationはEditorial List(Typography・Divider・Whitespaceで整理)、Networkは専用の関係性UIとする。全情報をカードにしない
- 禁止事項: 過剰なグラデーション・グラスモーフィズム・巨大カード・過剰な角丸・大量のシャドウ・巨大ボタン・KPIダッシュボード風UI・SpotifyやDiscogsのクローン

## 空データの扱い

各セクションでデータが0件の場合、大きな空状態カードは出さない。「No rotation data available.」のような静かな1行のみ。

## パフォーマンス方針

- `layout.tsx`は「LEFT表示に必要な情報」+「RIGHTの9カウント」のみ取得する。Discography全件・Timeline全項目・Network全関係などは取得しない
- 各セクションの`page.tsx`は、そのセクションが実際に表示する分だけを取得する(Discographyはページング済みの1ページ分、Timelineは必要な範囲、Media/Ranking/Awards/Radio Rotationも同様)
- N+1クエリを避ける(既存の`buildArtistAlbumQuery`等、既に確立したクエリヘルパーを再利用することで自然に満たす)
- 画像は既存の`<img>`+object-fit運用を踏襲する(このプロジェクトは現状next/imageを使っていないため、新規にnext/imageへ切り替えることはしない。既存の慣習に合わせる)

## テスト方針

- 既存の詳細ページ改修(2026-09-08)と同様、Playwrightによる実ブラウザ確認を実装後に行う: PC(3カラム比率・sticky挙動・セクション間遷移でLEFT/RIGHTが再マウントされないこと)、Mobile(2列ナビゲーション・縦スクロール・Discography2列)の両方
- セクションURLへの直接アクセス(例: `/artists/[id]/discography`を直接開く)が正しく動作すること
- データ0件のセクション(受賞歴が無いアーティスト等)で空状態が正しく出ること
- 既存の`/artists/[id]/timeline`への直リンク・外部からの参照がある場合の扱いは実装時に確認する(新URL構成でも同一パスのため、リダイレクト等は不要な見込み)
