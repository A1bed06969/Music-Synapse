# レコード屋ディグり体験 設計

## 背景

ユーザーから、レコード屋で棚を掘る(ディグる)感覚で登録アルバムと出会えるコンテンツの要望があった。参考画像(木箱に差さったレコード、ジャンル仕切りタブ、手でジャケットをめくる質感)が提示されている。

ブレインストーミングで確認済みの方針:

1. **ジャンル棚の範囲**: 611件登録されているジャンルのうち、実際にアーティストへタグ付けされているのは249件、上位ジャンル(Rock 87組等)に偏っており下位は1〜2組のみ。「十分な枚数がある上位ジャンルだけを棚として出す」方針とする(閾値は本仕様で定義)。
2. **入口**: 全ページ共通の右下フローティングバナー。タップで全画面モーダルがその場で開く(URL変化なし)。
3. **上スワイプ(アルバム詳細へ)**: モーダルを閉じて通常の`/albums/[id]`へ遷移する。
4. **下スワイプ(次のレコード)のランダム性**: 完全ランダムではなく、その棚を一周するまで重複しないシャッフル方式。
5. **試聴不可のアルバムも混ぜる**: `preview_url`の有無を棚の対象条件にしない(ジャケットがあれば対象)。試聴できない盤は自動再生をスキップし、その旨を控えめに表示する。
6. **SE**: 外部音源ファイルは使わず、Web Audio APIでその場で合成する(レコード切り替え時の短い音、上スワイプで「取り上げる」ときの余韻のある音)。
7. **初回の棚**: モーダルを開いた直後は常に「新着」棚(直近30日以内にリリースされたアルバム、ジャンル不問)から開始する。左右スワイプで「新着 → ジャンルA → ジャンルB → ... → 新着」という順で棚を巡回する。
8. **ビジュアル**: 参考画像に忠実な質感(木目・紙質感・暖色照明)を、サイト独自のオリジナル背景として新規に作る(参考画像ファイル自体は使わない)。
9. **名称**: フローティングボタンの表示名は「Junkie Dig」とする。

## ゴール

- 全ページから右下のフローティングバナーで開ける、全画面モーダルの「ディグり」体験を追加する
- ジャンルタグが十分に付いている棚だけを自動抽出し、新着棚と合わせてスワイプで巡回できる
- 下/上/左右のスワイプ(タッチ・マウスドラッグ・矢印キー)でレコード送り・詳細遷移・棚切り替えができる
- レコードが切り替わるたびに、試聴可能なら1曲目(30秒プレビュー)を自動再生する。既存の`usePreviewPlayer`(1曲だけ同時再生)と共存する
- レコード切り替え・詳細への遷移それぞれに専用のSE(Web Audio API合成)を鳴らす
- 木目・紙質感のオリジナル背景と、参考画像を意識したジャンル仕切りタブUIを作る

## 非ゴール

- ジャンルタグ自体の拡充(タグ付け作業)は行わない。現状のタグ付けデータをそのまま使う
- レコード店の背景画像を複数用意して棚ごとに出し分けることはしない(1種類の固定背景で統一する)
- 外部音源ファイル・音楽ライブラリの追加導入はしない(SEは全てWeb Audio APIでの合成)
- オフライン対応・PWA化はしない
- 「取り上げた(お気に入り/後で聴く)」を保存する機能は作らない(今回はその場の発見体験のみ)
- デスクトップでのドラッグ操作の物理慣性(モメンタムスクロール)の精緻な再現はしない。閾値を超えたスワイプ/ドラッグで即座に確定する単純な判定で十分とする

## データモデル

新規テーブル・カラムは不要。既存の`album` / `track` / `artist` / `genre` / `artist_genre`を組み合わせて取得する。

### 棚(ジャンル)の抽出条件

「棚」として採用するジャンルは、以下の条件を満たすアルバムを**8枚以上**持つものとする(定数`MIN_SHELF_ALBUMS = 8`として実装、後から調整しやすいようファイル冒頭に定義):

- `album.jacket_url IS NOT NULL`(ジャケット必須。試聴の有無は問わない)
- `album.artist_id`が`artist_genre`経由でそのジャンルに紐づいている

このクエリはモーダルを開くたびに走らせるとコストが高いため、`utils/recordDigging.ts`に以下の関数を用意しサーバー側で一度に計算する:

```ts
export type DiggingShelf = {
  key: string // 'new-arrivals' または genre.id
  label: string // '新着' または genre.name
  isGenre: boolean
}

export type DiggingRecord = {
  id: string
  title: string
  jacketUrl: string
  artistId: string
  artistName: string
  releaseDate: string | null
  firstTrackId: string | null
  firstTrackPreviewUrl: string | null
}

/** 棚として採用できるジャンル一覧(閾値以上のアルバムを持つもののみ)を返す */
export async function fetchEligibleGenreShelves(supabase: Supabase): Promise<DiggingShelf[]>

/** 指定した棚(ジャンルkey、または'new-arrivals')に属するレコード一覧を返す。
 * 'new-arrivals'指定時はジャンル不問で release_date が直近30日以内のアルバムを返す */
export async function fetchShelfRecords(supabase: Supabase, shelfKey: string): Promise<DiggingRecord[]>
```

`fetchShelfRecords`は各アルバムの「1曲目」を`track_no`昇順(disc_number昇順優先)で1件だけ取得し、`firstTrackId` / `firstTrackPreviewUrl`に含める(`preview_url`がなければ`null`のまま返す — UI側で「配信情報なし」表示に使う)。

### APIルート

モーダルはクライアント側で棚を切り替えるたびにデータが必要なため、Server Actionではなく軽量なAPIルートを1本用意する:

- `GET /api/record-digging/shelves` — `fetchEligibleGenreShelves`の結果(+ 先頭に`new-arrivals`を追加した配列)を返す。モーダルを開いた瞬間に1回だけ呼ぶ
- `GET /api/record-digging/records?shelf={key}` — `fetchShelfRecords`の結果を返す。棚を切り替えるたびに呼ぶ

どちらも認証不要(Basic Auth配下の通常ページと同じ扱い)、レスポンスはJSON。

## コンポーネント構成

```
app/
  components/
    record-digging/
      RecordDiggingLauncher.tsx   (フローティングボタン「Junkie Dig」 + モーダルの開閉状態管理。'use client')
      RecordDiggingModal.tsx      (全画面モーダル本体。棚状態・レコード配列・スワイプ判定)
      RecordSleeve.tsx            (中央のジャケット表示 + スワイプ方向のヒント演出)
      GenreShelfTabs.tsx          (参考画像の仕切りタブ風UI。現在の棚名 + 前後の棚名をうっすら表示)
      useSwipeGesture.ts          (タッチ/マウスドラッグ/矢印キーを統一的に「up/down/left/right」イベントへ変換するフック)
      useDiggingSound.ts          (Web Audio APIでのSE合成。'flip'と'pickup'の2種類)
  api/
    record-digging/
      shelves/route.ts
      records/route.ts
utils/
  recordDigging.ts                (上記のfetchEligibleGenreShelves / fetchShelfRecords)
```

`app/layout.tsx`の`<PreviewPlayerProvider>`内、`<main>`と並べて`<RecordDiggingLauncher />`を配置する(全ページ共通・`usePreviewPlayer`をそのまま使うため)。

### 状態管理(RecordDiggingModal内)

```ts
const [shelves, setShelves] = useState<DiggingShelf[]>([])       // 開いた瞬間に1回取得、先頭は必ずnew-arrivals
const [shelfIndex, setShelfIndex] = useState(0)                   // 現在の棚のインデックス
const [deck, setDeck] = useState<DiggingRecord[]>([])              // 現在の棚のシャッフル済み配列
const [deckPosition, setDeckPosition] = useState(0)                // deck内の現在位置
```

- 棚切り替え(左右スワイプ): `shelfIndex`を±1(配列端は循環)。新しい棚の`records`をAPIから取得し、シャッフルして`deck`にセット、`deckPosition = 0`。
- 次のレコード(下スワイプ): `deckPosition + 1`。`deck.length`に達したら再シャッフルして`deckPosition = 0`に戻す(直前の1枚が再シャッフル直後の1枚目に来ないよう、Fisher-Yatesシャッフル後に末尾と新しい先頭が一致していたら1回だけ入れ替える)。
- レコードが変わるたび(棚切り替え・次のレコードどちらも): `useDiggingSound`の`playFlip()`を鳴らし、`firstTrackPreviewUrl`があれば`setPlayingTrackId(firstTrackId)`、無ければ`setPlayingTrackId(null)`。
- 上スワイプ: `playPickup()`を鳴らしてから`setPlayingTrackId(null)` → `router.push(`/albums/${current.id}`)` → モーダルを閉じる。

## スワイプ判定(useSwipeGesture)

タッチ(`touchstart/move/end`)・マウス(`mousedown/move/up`)・キーボード(`ArrowUp/Down/Left/Right`)を共通の`onSwipe(direction: 'up'|'down'|'left'|'right')`コールバックに正規化する。判定ロジック:

- ドラッグ開始点からの移動量が、縦横どちらも**80px**を超えた時点で方向確定(それまではプレビュー的に追従させるが確定はしない)
- 縦横の移動量を比較し、絶対値が大きい方を採用(斜めドラッグの誤判定を防ぐ)
- 確定したら即座に`onSwipe`を発火し、それ以降のmove/touchmoveは無視する(1ジェスチャー1回のみ)
- キーボードは閾値判定なしで即座に発火

## Web Audio SE (useDiggingSound)

`AudioContext`を1つ生成して保持し、2種類のSEをオシレーター+ノイズバッファで合成する(外部ファイルなし):

- **`playFlip()`**: 紙をめくるような短い音。ホワイトノイズバッファ(約80ms)にハイパスフィルタ+急速なゲイン減衰(exponentialRampToValueAtTime)をかけたもの
- **`playPickup()`**: レコードを持ち上げる、少し余韻のある音。低めのサイン波オシレーター(200Hz→120Hzへピッチベンド)+短いノイズを重ね、300ms程度でフェードアウト

`AudioContext`はブラウザの自動再生制約により、最初のユーザー操作(フローティングボタンのクリック)のタイミングで生成する(それより前に生成しない)。

## ビジュアル

- **背景**: 暖色照明・木箱を思わせるオリジナル背景。CSSグラデーション(暖色系の照明ムラ)+ SVGの木目パターン(横縞のノイズ模様を`<filter>`のfeTurbulenceで生成)を組み合わせて実装する(画像アセットの新規調達はしない、コードで完結させる)
- **ジャケット**: `RecordSleeve`で中央に大きく正方形表示。`object-contain`、影を落として「棚に差さった1枚を引き出した」ような立体感を出す。試聴不可の盤は右下に小さく「配信情報なし」バッジ
- **次・次々レコードのチラ見せ**: 現在の1枚の奥(下方向、スケール縮小+暗め)に、下スワイプで来る次・次々のレコード(`deck[deckPosition+1]`・`deck[deckPosition+2]`)のジャケットを少しだけ覗かせる。カード積みのような奥行き演出とし、「次に何が来るか」を完全には見せない(クロップ+低opacityで縁だけ見える程度)。左右スワイプの棚送りには適用しない(棚ごとdeckが総入れ替えになるため)
- **ジャンル仕切りタブ**: `GenreShelfTabs`でジャケット上部に、参考画像の仕切り札のように現在の棚名を強調表示し、その左右に前後の棚名を薄く覗かせる(左右スワイプの示唆になる)
- **スワイプヒント**: 初回表示時のみ、上下左右にうっすら矢印アイコン+ラベル(「次へ」「詳細へ」「棚を変える」)を数秒表示してフェードアウトする

## エラー・空データ処理

- 棚が1件もタグ付け条件を満たさない場合(理論上は起きにくいが): 「新着」棚のみで運用し、左右スワイプは無効化(ボタンやヒントを出さない)
- 「新着」棚が0件(直近30日にリリースが無い月)の場合: モーダルを開いた瞬間に自動でジャンル棚(先頭のもの)にフォールバックする
- API取得失敗時: モーダル内に簡潔なエラーメッセージ+「閉じる」のみ表示(リトライは求めない)

## テスト

- `utils/recordDigging.ts`の2関数は、Supabaseクライアントをモックしたユニットテストで検証する(閾値境界: 7枚/8枚/9枚での棚採用可否、新着の日付境界)
- スワイプ判定(`useSwipeGesture`)は、jsdom上でtouch/mouseイベントを疑似発火させ、80px閾値の境界・斜めドラッグでの主軸判定をテストする
- 実際のブラウザでの動作確認は、`npm run dev`起動後にモーダルを開き、Chrome DevToolsのタッチエミュレーションで4方向スワイプ・SE再生・自動再生・棚一周後の再シャッフルを目視確認する(このアプリのE2Eテスト基盤は無いため手動確認とする)
