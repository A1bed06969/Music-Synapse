# ジャンル年表 設計

## 背景

年表タペストリー機能(アーティスト年表・ジャンル年表・レーベル年表の3軸、`docs/superpowers/specs/2026-08-18-label-timeline-design.md`参照)の3本目。レーベル年表・アーティスト年表は実装済みだが、ジャンル年表は「別途brainstormingし、独立したspec/planサイクルで進める」として先送りされていた。

レーベル・アーティストと異なり、ジャンルには以下の制約がある:

- `genre`テーブルの`origin_year`は現在158件全てNULL(未入力)
- `artist_genre`(アーティスト⇔ジャンル紐付け)には日付列が無い
- MusicBrainzのようにジャンルの発祥年・地域・派生関係を持つ外部APIが無い(MusicBrainzのgenreは単なるタグ)

一方でWikipediaの`{{Infobox music genre}}`テンプレートは、日英どちらの版でも共通のフィールド名(`stylistic_origins`=起源ジャンル、`cultural_origins`=発祥年代+地域、`derivatives`=派生ジャンル、`subgenres`=サブジャンル)を持ち、実データで構造が確認できた(Techno/英語版、シティ・ポップ/日本語版で検証済み)。これを新しいデータソースとして使う。

また公開向けのジャンル詳細ページ自体がまだ存在しない(`/relations`でジャンル名がテキスト表示されるのみ)ため、新規ページとして作る。

参考イメージ: Ishkur's Guide to Electronic Musicのような、時間軸に沿ってジャンルが支流のように枝分かれしていく系譜図。ただし今回は曲線でつながるビジュアル図ではなく、既存のレーベル年表・アーティスト年表と同じ縦一本のリストで、インデントと発祥地テキストによって派生関係を表現する。

## ゴール

- Wikipediaでジャンルを検索し、発祥年・発祥国/都市・起源ジャンル・派生ジャンル/サブジャンルの候補をプレビューした上で取り込めるようにする(既存のMusicBrainzレーベル検索・ディスクガイドApple Music候補確認と同じ「検索→候補確認→人間が選ぶ」パターン)
- ジャンルの派生関係(親ジャンル→サブジャンル)をDBに保持し、複数の起源・複数の派生を表現できるようにする
- ジャンルごとに代表アーティスト/代表作品を手動で紐付けられるようにする
- 新規の公開ジャンル詳細ページに、発祥・派生ジャンル・代表アーティスト/作品・ジャンルタグ付きアーティストのアルバムリリースを時系列1本にまとめた「年表」を追加する

## 非ゴール(今回やらないこと)

- 画像例のような曲線でつながるビジュアル系譜図。インデント+テキストで表現する(将来の拡張候補として残す)
- 複数ジャンルを1枚の図で比較するタペストリービュー(単一ジャンル単位のページのみ)
- 158件全ジャンルの一括自動取込。レーベル同様、1件ずつ人間が確認して取り込む
- 発祥都市の地図プロット(座標収集は別ロードマップ項目、ユーザーの将来機能ロードマップ#4)
- Wikipediaの`stylistic_origins`/`subgenres`/`derivatives`に出てきた未登録ジャンル名の自動新規作成。既存`genre`とのファジーマッチのみ行い、一致しなければテキスト表示に留める

## データの前提(実APIで確認済み)

- 取得: `GET https://{ja|en}.wikipedia.org/w/api.php?action=parse&page={title}&format=json&prop=wikitext&section=0`。認証不要
- 日本語版を先に試し、記事が無い(APIが`error.code=missingtitle`を返す)か`{{Infobox music genre`を含まない場合は英語版にフォールバック
- インフォボックスのフィールド値は主に3パターンで包まれる:
  - `{{Hlist|[[A]]|[[B]]|...}}` または `{{Hlist-comma|...}}` — パイプ区切りのリンク一覧
  - `{{Plainlist| * [[A]] * [[B]] }}` — 箇条書き
  - 装飾なしの自由文(英語版`cultural_origins`によくある形: `Mid-1980s, Detroit, Michigan, U.S.`)
- リンクは`[[表示名]]`または`[[記事名|表示名]]`の形。表示名(無ければ記事名)を取り出す
- `cultural_origins`から年/年代を先頭の`\d{4}`または`\d{4}年代`/`\d0s`パターンで抽出し、残りのリンク・`{{JPN}}`等の国旗テンプレート名を地域文字列として連結する(国と都市の判別までは行わず、`origin_country`に地域文字列をそのまま入れる。都市が明確に分かる場合のみ`origin_city`に入れる、という厳密な分離は今回は行わずベストエフォート)

## アーキテクチャ

```
supabase/migrations/20260821_add_genre_lineage.sql (新規)
  ├─ ALTER TABLE genre ADD COLUMN origin_country TEXT;
  ├─ ALTER TABLE genre ADD COLUMN origin_city TEXT;
  ├─ ALTER TABLE genre ADD COLUMN wikipedia_url TEXT;
  ├─ CREATE TABLE genre_lineage (
  │      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  │      parent_genre_id TEXT NOT NULL REFERENCES genre(id) ON DELETE CASCADE,
  │      child_genre_id TEXT NOT NULL REFERENCES genre(id) ON DELETE CASCADE,
  │      UNIQUE (parent_genre_id, child_genre_id)
  │    );
  └─ CREATE TABLE genre_highlight (
         id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         genre_id TEXT NOT NULL REFERENCES genre(id) ON DELETE CASCADE,
         artist_id TEXT REFERENCES artist(id) ON DELETE CASCADE,
         album_id TEXT REFERENCES album(id) ON DELETE CASCADE,
         note TEXT,
         CHECK (artist_id IS NOT NULL OR album_id IS NOT NULL)
       );

utils/wikipediaGenre.ts (新規)
  ├─ export type WikipediaGenreInfo = {
  │      sourceUrl: string
  │      originYear: number | null
  │      originPlace: string | null      // cultural_originsから地域として抽出した文字列
  │      stylisticOrigins: string[]      // 起源ジャンル名(表示名)一覧
  │      subgenres: string[]
  │      derivatives: string[]
  │    }
  └─ export async function searchWikipediaGenre(name: string): Promise<WikipediaGenreInfo | null>
       (ja.wikipedia.orgでaction=parse、インフォボックス無ければen.wikipedia.orgにフォールバック。
        両方失敗/インフォボックス無しならnull)

app/admin/data/genres/actions.ts (追記)
  ├─ lookupWikipediaGenre(name: string): Promise<WikipediaGenreInfo | null>
  │    ('use server'、クライアントから直接呼ぶ。既存のsearchMusicBrainzLabelと同じ形)
  ├─ applyWikipediaGenreLookup(formData): 選択されたジャンルにoriginYear/originPlace(→origin_country)/
  │    wikipedia_urlを保存。stylisticOrigins/subgenres/derivativesの各名前をgenre.nameとilikeで
  │    照合し、1件だけ一致すればgenre_lineageへupsert(stylisticOrigins→対象ジャンルが子、
  │    subgenres/derivatives→対象ジャンルが親)。一致しない名前は何もしない(UIでテキスト表示のみ)
  └─ addGenreHighlight(formData) / deleteGenreHighlight(formData): genre_highlightのCRUD
       (artist_id・album_idはどちらか必須、note任意)

app/admin/data/genres/page.tsx (追記)
  └─ 既存の「ジャンル追加」「アーティスト紐付け」フォームに加え:
       - ジャンルを選んでWikipedia検索するフォーム(既存レーベルのMusicBrainz検索UIと同じ
         クライアントコンポーネントでの検索→候補プレビュー→確認パターン)
       - ジャンルを選んで代表アーティスト/作品を紐付けるフォーム(SearchableSelectを流用)

utils/genreTimeline.ts (新規、labelTimeline.tsと同じ形)
  ├─ export type GenreTimelineEntry = {
  │      date: string
  │      kind: 'origin' | 'derived' | 'release' | 'highlight'
  │      title: string
  │      subtitle: string | null   // 発祥地、代表作品名など
  │      href: string | null
  │      indent: boolean           // サブジャンル/派生ジャンルの行はtrue
  │    }
  └─ export function buildGenreTimeline(input: GenreTimelineInput): GenreTimelineEntry[]
       以下をマージし日付昇順ソート:
         - このジャンル自身の発祥: date=`${origin_year}-01-01`, kind='origin', indent=false,
           subtitle=origin_country/origin_cityがあれば連結
         - サブジャンル/派生ジャンル(genre_lineageで繋がっている先)のうちorigin_yearが
           設定されているもの: date=そのジャンルのorigin_year, kind='derived', indent=true,
           title="{子ジャンル名}が派生", subtitle=その子ジャンルのorigin_country/city,
           href=`/genres/{子genre.id}`
         - 各ジャンル(自身+サブジャンル/派生ジャンル)に紐づくgenre_highlight:
           date=紐づく先ジャンルのorigin_year(無ければ除外), kind='highlight', indent=そのジャンルが
           サブジャンル側ならtrue, title="代表: {artist.name}「{album.title}」"(album/artistの
           どちらか無ければ省略), href=album_idがあれば`/albums/{id}`、無ければ`/artists/{id}`
         - ジャンルタグ付きアーティストのアルバムリリース(既存artist_genre→album.release_date):
           date=release_date, kind='release', indent=false, title="{artist.name}「{album.title}」リリース"
       origin_year/release_dateが無い行は年表に出さない(レーベル年表と同じ方針)

app/genres/[id]/page.tsx (新規)
  └─ ジャンル名、origin_year+origin_country/city(あれば)、wikipedia_urlへの出典リンク
     (favicon付き、Tower Records/Google Booksの出典表示と同じパターン)、<GenreTimeline>を表示

app/genres/[id]/GenreTimeline.tsx (新規、サーバーコンポーネント、LabelTimeline.tsxと同じ形)
  └─ props: 上記の各データ配列をpage.tsxから受け取り、buildGenreTimelineでマージして描画。
     indent=trueの行は左に追加インデントを入れて「派生」であることを視覚的に示す

app/relations/page.tsx (変更)
  └─ ジャンル名のテキスト表示を`/genres/{id}`へのリンクに変更(genre_idを既に取得済みのクエリに含める)

app/admin/data/genres/page.tsx (変更)
  └─ ジャンル一覧に`/genres/{id}`への「公開ページを見る →」リンクを追加
```

## UI

年表の見た目はレーベル年表(`app/labels/[id]/LabelTimeline.tsx`)を踏襲: 縦一本の線に沿ってドットとテキストを並べ、年をまたぐ区切りに年ラベルを挟む。追加要素として、`indent=true`の行(サブジャンル/派生ジャンルとその代表作品)は左に一段インデントを入れ、「◇→」のような矢印アイコンで「ここから枝分かれ」であることを示す。曲線で結ぶビジュアルなグラフは作らない。

Wikipedia検索UIはレーベルのMusicBrainz検索フォームと同じ見た目(検索→候補一覧→「この候補で取込」ボタン)。取込結果には、ファジーマッチで自動リンクされたジャンル名と、一致せずテキストのまま残った名前を分けて表示し、後者は「該当ジャンルが未登録です」と分かるようにする。

## エラーハンドリング

- Wikipedia検索で該当記事/インフォボックスが無い: 「Wikipediaにインフォボックスが見つかりませんでした」と表示するのみ
- `origin_year`が無いジャンル: 年表からそのジャンル自身の発祥行は省略(既存の「日付が無い行は出さない」方針)
- `genre_highlight`のartist_id/album_idはどちらか必須(DB CHECK制約 + フォームバリデーション両方)
- ファジーマッチが2件以上ヒットする場合は自動リンクせずスキップ(過剰マッチ回避、既存の`registerOneConfirmedAlbum`と同じ`.limit(1).maybeSingle()`ではなく、2件以上を明示的に除外する判定にする)

## テスト方針

- `utils/wikipediaGenre.ts`の`searchWikipediaGenre`: 実APIを叩く統合テスト2本(英語版Techno→`originYear=1985`前後・`cultural_origins`からDetroitを含む地域文字列が取れること、日本語版シティ・ポップ→ja版がヒットし1970年代・日本が取れること)
- `utils/genreTimeline.ts`の`buildGenreTimeline`: 単体テストでマージ・ソート・インデント判定を検証(親ジャンルの発祥+サブジャンル2件(発祥年あり/なし混在)+代表アーティスト/作品+アルバムリリースを混在させた入力で、日付昇順に並ぶこと、origin_year無しのサブジャンル発祥行が省略されること、サブジャンル関連行がindent=trueになることを確認)
