# レーベル年表 設計

## 背景

年表タペストリー機能(アーティスト年表・ジャンル年表・レーベル年表の3軸)の第1弾として、レーベル年表から着手する。理由:

- `label`テーブルに`founded_year`、`artist_label`テーブルに`start_date`/`end_date`が既に存在し、`album.label_id`経由でリリース日も辿れる。新規テーブルなしで年表を組み立てられる
- レーベル詳細ページ(`app/labels/[id]/page.tsx`)は既に創設者・所属アーティスト・カタログ・アワード受賞歴を取得済みで、これらを時系列にマージするだけで年表になる
- 管理画面(`app/admin/data/labels/page.tsx`)にレーベル作成・アーティスト所属紐付け・アルバム紐付けの手動フォームは既にあるが、MusicBrainz連携は未実装
- 現状DBに登録されているレーベルは2件のみ(HEHN RECORDS, RCA Records)。モータウン・ブルーノート・4AD・Pizza of Death等、ユーザーが挙げた実在レーベルは1件も無く、データ収集自体が本機能のスコープに含まれる

ジャンル年表・アーティスト年表は別途brainstormingし、それぞれ独立したspec/planサイクルで進める(このspecの対象外)。

## ゴール

- MusicBrainzでレーベルを検索し、候補を確認した上でレーベルを取り込めるようにする(既存のアーティスト取込・フェス出演者取込と同じ「検索→候補確認→人間が選ぶ」パターン)
- レーベル詳細ページに、発足・創設者・アーティスト加入/脱退・アルバムリリース・アワード受賞を時系列1本にまとめた「年表」セクションを追加する

## 非ゴール(今回やらないこと)

- ジャンル年表・アーティスト年表(別spec)
- 自由文の手入力イベント(「1962年、あの伝説のヒット曲をリリース」等)。今回は既存データからの自動導出のみ
- レーベルの一括インポート・自動発見。フェスパイロットと同様、1件ずつ人間が確認して取り込む
- 複数レーベルを1枚の年表で比較する「タペストリー」ビュー。まずは1レーベル単体の年表ページから
- MusicBrainzの`annotation`(wiki記法混じりの自由記述)の取込み。`description`は引き続き手動入力のみ
- レーベルの活動終了(解散・買収)の表現。`founded_year`のみ扱い、終了年は今回のスコープ外

## データの前提(実APIで確認済み)

- 検索: `GET https://musicbrainz.org/ws/2/label?query={name}&fmt=json&limit=5`。認証不要、`User-Agent`ヘッダー必須。結果は`id`(MBID)・`name`・`type`(Original Production等)・`country`・`area.name`・`life-span.begin`(例: `"1959-09"`、年月or年のみの文字列)を含む
- 詳細取得: `GET https://musicbrainz.org/ws/2/label/{mbid}?fmt=json`。検索結果とほぼ同じ内容(`life-span.begin`、`area.name`、`disambiguation`)を返す。今回は検索結果の情報だけで十分なため、詳細取得は行わず検索結果からそのまま作成する
- レート制限: 1リクエスト/秒(既存の`utils/musicbrainz.ts`の`fetchMusicBrainz`が503リトライ込みで実装済み、流用する)
- `life-span.begin`から年だけを取り出す(`"1959-09"` → `1959`、`"1959"` → `1959`)。無ければ`founded_year`はnull

## アーキテクチャ

```
utils/musicbrainz.ts (追記)
  ├─ export type MusicBrainzLabelSearchResult = {
  │      mbid: string
  │      name: string
  │      type: string | null
  │      country: string | null
  │      areaName: string | null
  │      foundedYear: number | null
  │    }
  └─ export async function searchLabel(name: string): Promise<MusicBrainzLabelSearchResult[]>
       (fetchMusicBrainzを流用、life-span.beginから年を正規表現で抽出)

app/admin/data/labels/actions.ts (追記)
  ├─ searchMusicBrainzLabel(name: string): Promise<MusicBrainzLabelSearchResult[]>
  │    (searchArtist系と同じく'use server'関数を直接クライアントから呼ぶ形。認証チェック不要、
  │     Basic認証で管理画面全体が既に保護されている前提を踏襲)
  └─ createLabelFromMusicBrainz(formData): 選択された候補からlabel行を作成
       (name, founded_year。description/name_kanaは空のまま、既存のcreateLabelフォームで後から
        手動編集する想定。同名レーベルが既に存在する場合は確認なしで新規作成せず、
        既存行のfounded_yearが空なら埋めるだけに留める — upsertArtistFromItunesの重複防止と同じ考え方)

app/admin/data/labels/page.tsx (追記)
  └─ 既存の「レーベル名/ふりがな/設立年/概要」手動フォームの上に、MusicBrainz検索フォームを追加。
     検索結果は名前・種別・国・設立年を並べたリストで、各行に「この候補で作成」ボタン
     (フェスパイロットのUnmatchedArtistTagと同じ、クライアントコンポーネントでの検索→候補表示パターン)

app/labels/[id]/LabelTimeline.tsx (新規, サーバーコンポーネント)
  └─ props: { foundedYear, founders, roster, catalog, awards }
       (app/labels/[id]/page.tsxが既に取得済みのデータをそのまま渡す。追加のDBクエリは無し)
     以下を1本のリストにマージしてdate昇順ソートし、縦の年表として描画する:
       - 発足: date = `${foundedYear}-01-01`, label = "レーベル発足"
       - 創設者: foundedYearと同じ日付に束ねて表示(創設者は日付を持たないため)
       - アーティスト加入: date = artist_label.start_date, label = "{artist.name} 加入"
       - アーティスト脱退: date = artist_label.end_date(存在する場合), label = "{artist.name} 脱退"
       - アルバムリリース: date = album.release_date, label = "{artist.name}「{album.title}」リリース"
       - アワード受賞: date = `${award.year}-01-01`(年単位のため), label = "{artist名|album名} {award名} {category} 受賞"
     日付がnullの行(start_date未入力の所属等)は年表には出さず、既存の所属アーティスト一覧側にのみ表示する
     (年表は「日付が分かる出来事」だけを扱う)

app/labels/[id]/page.tsx (変更)
  └─ 既存の所属アーティスト/カタログ/アワードの各セクションは変更せず維持したまま、
     概要の直後に<LabelTimeline>を追加する
```

## UI

年表は縦の1本線に沿ってドットとテキストを並べる形式(既存の`app/events/[id]/EventScheduleView.tsx`の日程カードや、`app/artists/[id]/page.tsx`のライブ情報リストと近い簡素な見た目)。年をまたぐ区切りに小さく年ラベルを挟み、同じ年の出来事はまとめて表示する。アーティスト加入/脱退/リリースが多いレーベル(例: Motownは所属アーティストもカタログも多くなりうる)は縦に長くなることを許容し、ページネーションや折りたたみは今回実装しない(既存のアルバム一覧・出演履歴等も同様の方針のため)。

## エラーハンドリング

- MusicBrainz検索で候補が0件: 「候補が見つかりませんでした」と表示するのみ(フェスパイロットと同じ)
- `founded_year`が無いレーベル: 年表は空のまま(「まだ出来事が登録されていません」のような既存パターンのメッセージ)
- 既存の`createLabel`(完全手動フォーム)は変更しない。MusicBrainz検索はあくまで追加の入口

## テスト方針

- `utils/musicbrainz.ts`の`searchLabel`: 実APIを叩く統合テスト1本(Motownで検索して`life-span.begin`から`1959`が取れることを確認、既存の`searchArtist`のテストがあれば同じ形式に揃える)
- `LabelTimeline`: 単体テストでマージ・ソートロジックを検証(発足年・複数アーティストの加入/脱退・複数アルバム・受賞を混在させた入力で、日付昇順に並ぶこと、日付nullの行が除外されることを確認)
