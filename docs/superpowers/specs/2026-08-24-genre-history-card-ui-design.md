# ジャンル年表 カード型UI 設計

## 背景

現在の`/genres/[id]`は、年代を共通の目盛りにした縦軸タイムライン(`GenreTimeline.tsx`、2026-08-23実装)で発祥・サブジャンル・代表アーティスト・出来事を表示している。

ユーザーから、ブルースの年表を題材にした詳細なUI参考画像・仕様(20項目)が提示された。要旨:

- 年代ごとの大型カードを横一列のタイムラインとして並べ、クリックした年代の詳細(歴史・代表アーティスト・代表作品)を下部パネルに展開するインタラクティブなカードUI
- サブジャンル同士の派生・影響関係を「GENRE EVOLUTION」として可視化する(実線=主な派生、点線=影響、破線=クロスオーバー)
- ダーク・エディトリアルなトーン(データベース/デジタルアーカイブ的な雰囲気、SaaS管理画面やSpotify風は避ける)
- データとUIの分離、将来のDB接続を見据えた設計

ユーザー確認済みの方針(3件):
1. **全242ジャンル共通の`/genres/[id]`を置き換える**(ブルース専用ページは作らない)
2. **`genre_lineage`に`relation_type`列を追加**(derivation/influence/crossover)し、実線/点線/破線を表現する
3. **ブルースの派生関係を多段階に拡張する**(現状はblues→6件の直接の子というフラット構造。Delta Blues→Chicago Blues、Blues Rock→Hard Rock/Garage Rock/Punk Blues等の多段階の鎖を今回追加する)

## ゴール

- `/genres/[id]`を、年代カードのインタラクティブ・タイムライン + 下部詳細パネル + ジャンル進化グラフの構成に置き換える
- 表示データは全てDB由来(`genre`/`genre_lineage`/`genre_highlight`/`artist`/`album`)とし、ハードコードしない
- ブルースの`genre_lineage`を多段階の派生関係に拡張し、`relation_type`で派生/影響/クロスオーバーを区別する
- 既存の「ジャンル一覧」「アーティスト/アルバムページへのリンク」等、他画面には影響を与えない

## 非ゴール

- 新しいURLパターン(`/genre/chicago-blues`等)は作らない。既存の`/genres/[id]`(idは`MS_GNR_xxxx`)、`/artists/[id]`、`/albums/[id]`をそのまま使う
- Framer Motion等のアニメーションライブラリは導入しない。既存コードベース全体がTailwindのtransition/hoverユーティリティのみで統一されているため、それに合わせる(CSSのtransition/animationで十分に上品な動きは作れる)
- ブルース以外のジャンルに新しい多段階派生を今回作り込むことはしない(データが薄い他ジャンルは、直接の子1段階のまま・カードが少ない状態で表示されるのは許容する。空でもレイアウトが崩れないことだけ保証する)
- キーボード操作の本格的なフォーカストラップ実装(タブ移動でカード選択ができる程度の基本対応のみ)

## データモデルの変更

### 1. `genre_lineage`に`relation_type`列を追加

```sql
ALTER TABLE genre_lineage ADD COLUMN relation_type TEXT NOT NULL DEFAULT 'derivation'
  CHECK (relation_type IN ('derivation', 'influence', 'crossover'));
```

既存の全行(ブルース6件含む)はデフォルトの`'derivation'`のまま(意味的にも「派生」で正しい)。

### 2. ブルースの派生関係を多段階に再構成

現状(フラット、6件): `blues → {カントリー・ブルース, デルタ・ブルース, クラシック・フィメール・ブルース, シカゴ・ブルース, ブルース・ロック, 日本のブルース, パンク・ブルース}`(7件、日本のブルース含む)

変更後(多段階):

```
blues (derivation)
 ├─ カントリー・ブルース (derivation)
 │   └─ デルタ・ブルース (derivation)
 │       └─ シカゴ・ブルース (derivation)
 │           └─ ブルース・ロック (derivation)
 │               ├─ パンク・ブルース (derivation)
 │               ├─ hard rock (derivation) ※既存ジャンル行に接続
 │               └─ garage rock (influence) ※既存ジャンル行に接続
 ├─ クラシック・フィメール・ブルース (derivation) ※直接の子のまま
 └─ 日本のブルース (derivation) ※直接の子のまま
```

- 既存の`blues→デルタ・ブルース`・`blues→シカゴ・ブルース`・`blues→ブルース・ロック`・`blues→パンク・ブルース`の直接エッジは削除し、上記の鎖に置き換える(同じジャンルが複数の深さに二重に現れて系統図が読みにくくなるのを避ける)
- `hard rock`・`garage rock`は既存のジャンル行(id確認済み)にそのまま接続する。新規ジャンル作成はしない
- `カントリー・ブルース`・`デルタ・ブルース`・`シカゴ・ブルース`・`ブルース・ロック`・`パンク・ブルース`の`background_note`(既存の解説文)はそのまま流用でき、変更不要

### 3. ERAカード生成の再帰化(既存バグの是正)

現在`app/genres/[id]/page.tsx`は`genre_lineage`の**直接の子のみ**(`allGenreIds = [id, ...childIds]`)からERA相当のカードを作っている。多段階化すると、例えばデルタ・ブルース(Robert Johnson)はblues自身のページからは「直接の子」ではなくなり、カードが1段減って見えなくなってしまう。

これを避けるため、ERAカードは**対象ジャンル自身+全descendant(子孫を再帰的に辿った全ジャンル)**の1件ずつから生成する(`genre_lineage`はブルース全体で高々十数行、再帰でもパフォーマンス上の問題はない)。カードの並び順は各ジャンルの`origin_year`昇順(同年は`genre_lineage`の登録順で安定ソート)。

重要: **各カードの「代表アーティスト/代表作品」は、そのカードに対応する1ジャンルの`genre_highlight`(直接紐付け分)のみ**を表示する。子孫のジャンルの`genre_highlight`を合算しない(合算すると、例えば「シカゴ・ブルース」のカードに子孫の「ブルース・ロック」のRolling Stonesが混入してしまう)。**再帰的なのはカード一覧の生成(どのジャンルをカード化するか)のみで、カード1枚ごとの中身(ハイライト)は非再帰的(直接紐付け分のみ)**である点に注意する。

この結果、ブルースは(blues本体+カントリー+デルタ+クラシック・フィメール+シカゴ+ブルースロック+日本+パンク+hard rock+garage rock =)10枚前後のカードになる。ユーザー提示の参考画像の6 ERAは例示であり、実データではジャンルツリーの実際のノード数がそのままカード数になる(ジャンルによっては1枚だけのこともある)。

## UI構成

### コンポーネント構成(ユーザー指定を踏襲)

```
app/genres/[id]/
  page.tsx                 (サーバーコンポーネント。データ取得のみ)
  GenreHistoryView.tsx      (クライアント、状態管理の起点)
  EraTimeline.tsx           (年代ノード+接続線の横一列)
  EraCard.tsx               (年代ごとの大型カード)
  EraDetailPanel.tsx        (選択中の年代の詳細パネル)
  GenreEvolution.tsx        (ジャンル進化グラフ、ノード+線+凡例)
  GenreEvolutionNode.tsx
  genreHistoryTypes.ts      (データ型定義。UIとデータ取得の分離点)
```

`utils/genreTimeline.ts`(現行の縦軸タイムライン用ロジック)は本UIでは使わなくなるため削除し、新しく`utils/genreHistory.ts`に「DB行 → `EraCardData[]`」の変換ロジックを置く(既存のWikipedia解析・年表以外の用途(`__tests__/genre-timeline.unit.test.ts`)は無いことを確認済み)。

### データ型(`genreHistoryTypes.ts`)

```ts
export type EraCardData = {
  genreId: string
  period: string          // 表示用ラベル。origin_year_label優先、無ければ`${origin_year}年`
  title: string            // ジャンル名(background_noteが無い場合のフォールバック見出し)
  region: string | null    // origin_country
  colorToken: EraColorToken // 年代インデックスから決定論的に割り当て(下記参照)
  description: string | null // background_note
  representativeArtists: { id: string; name: string; imageUrl: string | null }[]
  representativeWorks: { id: string; title: string; year: number | null; artistName: string | null }[]
  imageUrl: string | null  // 代表アーティストの画像 or 代表作品のジャケットのどちらか(先頭に見つかった方)
}

export type EraColorToken = 'amber' | 'yellow' | 'green' | 'blue' | 'coral' | 'purple'

export type GenreEvolutionNode = {
  genreId: string
  name: string
  x: number // レイアウト計算用(下記参照)
  depth: number
}
export type GenreEvolutionEdge = {
  fromGenreId: string
  toGenreId: string
  relationType: 'derivation' | 'influence' | 'crossover'
}
```

### ERAカードの生成ロジック

1. 対象ジャンル自身(`origin_year`があれば)を1枚目のERAカードにする
2. `genre_lineage`を再帰的に辿った全descendant(子・孫・…)を、`origin_year`昇順に並べて以降のERAカードにする
3. 各カードの代表アーティスト/作品は、**そのカード自身のジャンルIDに直接紐づく**`genre_highlight`のみを使う(子孫分は合算しない。前述「3. ERAカード生成の再帰化」参照)。年代の表示ラベルは`origin_year_label`優先、無ければ`event_year`のあるハイライトの年、どちらも無ければ`${origin_year}年`
4. 子が0件のジャンル(大半の242件中の非ブルース系ジャンル)は、ERAカード1枚(自分自身)のみのシンプルな表示になる。これはレイアウト上壊れないことだけ保証する(空のセクションは非表示にする)

### 年代カラー

ERAは配列インデックス基準で6色を順番に割り当てる(`amber, yellow, green, blue, coral, purple`のローテーション)。ジャンルの内容と色を紐付けるハードコードはしない(ブルース以外のジャンルにも同じロジックがそのまま使えるようにするため)。色はTailwindのカスタムクラスとして`EraCard`内に閉じ込め、Tailwind設定へのグローバル追加はしない(`style`属性かCSS変数で局所指定)。

### EraTimeline / EraCard

- 横一列、円形ノード+接続線(デスクトップ)。ノードクリックでそのカードまでスクロール+選択状態にする
- カード: タイトル・地域・代表アーティスト1件・代表作品1件(年込み)・画像・「詳細を見る →」
- 画像: 代表アーティストの`image_url`優先、無ければ代表作品の`jacket_url`、どちらも無ければプレースホルダー(既存の🎤/📀的な絵文字は今回のトーンに合わないため、シンプルな幾何学プレースホルダー(枠線+ジャンル名の頭文字)にする)
- hover: `translate-y`で微浮上、`border-white/40`、画像`scale-105`、矢印`translate-x-1`(すべてTailwindの`transition`で実装)
- selected: `ring`+`border`強調、下向きインジケーター、下の詳細パネルへの接続線(実装は縦の`border-l`を1本、選択カードの位置に応じて`left`をJSで計算するか、シンプルにカード直下に矢印アイコンを置く形に簡略化する)

### EraDetailPanel

- 選択中のERAの`period`+`title`を見出しに
- 3カラム(歴史・出来事 / 代表アーティスト / 代表作品)。モバイルは縦積み
- 選択カード切り替え時はCSSの`transition-opacity`+`key`変更でフェード

### GenreEvolution

- `genre_lineage`(relation_typeを再帰的に辿った全体)をツリーとして描画。ノード=ジャンル名(クリックで`/genres/{id}`へ遷移)、エッジ=`relation_type`に応じた実線/点線/破線
- レイアウトは複雑な自動グラフレイアウトライブラリを入れず、深さ(depth)ごとに1段ずつインデントする単純な入れ子リスト+SVG/border線の組み合わせで表現する(参考画像のツリー表記に近い、かつ実装・保守コストが低い)
- 凡例(LEGEND)を小さく併記

## レスポンシブ

- デスクトップ: 参考画像通り横一列のカード+タイムライン
- モバイル: `overflow-x-auto`でカードを横スクロール(`snap-x`でカード単位スナップ)。縦に6枚積むレイアウトにはしない(指示通り)
- 詳細パネルはモバイルでもカードの下に通常のブロックとして表示(横スクロールしない)

## エラーハンドリング・フォールバック

- `genre_highlight`が0件のERA: 「代表アーティスト」「代表作品」欄は「まだ登録されていません」を表示(既存の`GenreTimeline.tsx`の空状態メッセージ踏襲)
- 画像URLが不正/読み込み失敗: `onError`でプレースホルダーに切り替える(既存コードベースに前例が無いため新規追加。`<img>`の`onError`ハンドラのみ、ライブラリ不要)
- ジャンルに`origin_year`が無い(発祥年未設定): そのジャンル自身のERAカードは生成しない(現行の`buildGenreTimeline`と同じ扱い)。子ジャンルだけで年表が構成される

## テスト方針

- `utils/genreHistory.ts`のERAカード生成ロジック(DB行→`EraCardData[]`変換、再帰的なカード列挙+カードごとの非再帰的なハイライト割り当て、色のローテーション)は既存の`genreTimeline.ts`同様、DB不要な純粋関数としてユニットテストを書く(`__tests__/genre-history.unit.test.ts`)
- UIコンポーネントの自動テストは既存コードベースの方針(admin CRUD同様、自動テストなし)に合わせ、手動でブラウザ確認する(ブルース・データが薄い別ジャンル1件・データが空のジャンル1件の3パターン)
