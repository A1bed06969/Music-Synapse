# トラック/アルバムの名義統一(フィーチャリング分散の解消) 設計書

## 背景

`track`テーブルは`artist_id`が単一のため、「AのトラックにBがフィーチャリングした」楽曲が、実際にはAとBそれぞれの下に別々のtrack行として重複登録されている(album行ごと重複しているケースもある)。

2026-09-14の調査結果:

- タイトルに"feat"を含み、`(title, album title, track_no, duration_seconds)`が完全一致するにもかかわらず異なる`artist_id`に分散しているグループが**3,736件・関与トラック行9,683件**存在する
- 内訳: 2アーティスト分散が3,283件(88%)、3アーティストが328件、4組以上はわずか125件(下記の極端な例のような外れ値)
- 極端な例: 「Under the Mistletoe (feat. Dan Hicks)」は本来1曲のはずが、16行・5アーティスト・16個の異なるalbum_idに分散していた。元アルバム自体が9名のフィーチャリング参加者を含む(`Jugology - Greatest Near Misses...[feat. 9名]`)うえ、参加者の1人「Tim Eschliman」1アーティストだけで同一アルバムが9重複登録されていた(既存の重複統合プロジェクトが扱った「同一アーティストの複数行」問題と複合している)
- サンプル調査したところ、同一グループ内では title・album title・track_no・duration_secondsが常に完全一致していた
- フィーチャリング表記の主体はタイトル文字列と一致しないケースがある(例: 「シック」「ナイル・ロジャース」への分散は、タイトル内の"feat. Craig David & Stefflon Don"とは無関係 — Chic/Nile Rodgersはバンドとそのリーダーという別の分散パターン)

原因は、iTunes取込処理がアーティスト単位でカタログ同期を行う際、既に同じ楽曲が別アーティストの下に存在するかどうかを一切確認せず新規track行を作成してしまうため(アーティスト重複統合プロジェクトの根本原因調査と同じ「既存チェックの欠落」パターン)。

## ゴール

- 上記の重複を1つの正規化されたtrack行・album行に統合し、`track_artist`・`album_artist`中間テーブル経由で全ての関与アーティストを紐付ける
- 今後のインポート処理で同じ重複が再発しないよう、新規track/album作成前に「同一楽曲が既に別アーティストの下に存在するか」を確認する共通ガードを、既存の全インポート経路に組み込む
- フィーチャリング先のアーティストがまだカタログに存在しない場合でも、重複を生まない形でスタブ作成・後日の本登録に繋げる

## 非ゴール(今回のスコープ外)

- タイトルに"feat"という文字列を含まない名義違い重複(表記ゆれによる分散等)。今回は"feat"を含むタイトルのみを対象にし、同じ基盤を使って将来別途対応する
- 人物(person)単位のクレジット情報(プロデューサー・セッションミュージシャン等)。これは別スペック「関係性情報収集」で扱う
- billing_order(表示順)の完全な正確性の保証。タイトル解析とカタログの豊富さによるベストエフォートの推定に留め、間違っていても安全性(データ損失)には影響しないため、専用の人力確認フローは設けない
- タイトルの表記ゆれを許容するあいまい一致でのトラック/アルバム対応付け。今回もタイトル完全一致のみを対象にする(重複統合プロジェクトと同じ方針)

## 検出・マッチング基準

プラン作成時の追加調査で、重複album行が**全て同一の`apple_music_album_id`を持つ**ことを実データで確認した(例: 「Jugology」の6重複album行は全て`apple_music_album_id = "923737387"`)。これはタイトル文字列よりもはるかに確実な突合キーのため、優先的に使う。track側の`apple_music_track_id`も同様で、対象トラック(titleに"feat"を含む63,519件)のうち99.94%(63,483件)に設定されている。

対象は、track.titleが"feat"(大文字小文字を区別しない)を含み、かつ以下のいずれかの条件で2件以上・異なる`artist_id`にまたがっているグループ:

**主判定(優先)**: `apple_music_track_id`が両側とも非nullで完全一致する行(album側も同様に`apple_music_album_id`で判定)。外部ID同士の一致のため、タイトル文字列の表記ゆれに影響されず最も確実。

**副判定(apple_music_track_idが片側でもnullの場合のフォールバック)**: 以下が完全一致する行

- `track.title`(完全一致)
- 対応する`album.title`(完全一致)
- `track.track_no`(完全一致。片側がnullの場合はこの条件をスキップし、他の3項目のみで判定する)
- `track.duration_seconds`(完全一致。片側がnullの場合はこの条件をスキップし、他の3項目のみで判定する)

上記いずれの条件でグループ化した場合も、**同一artist_id内に一致する行が複数存在する場合**(同名異版等、既存の重複統合プロジェクトの`matchTracks`と同じ考え方)はそのグループ全体を「あいまい」としてスキップし、dry-runレポートに一覧化する(推測で統合しない)。

## 本体(canonical)track/albumの選定

各グループについて、以下の優先順位で1つのtrack行を本体として選ぶ(既存の`utils/artistDedupCanonical.ts`の`pickCanonical`と同じ考え方を、グループ内の候補に適用する):

1. 非nullの補完可能フィールド数(`youtube_video_id`, `preview_url`, `apple_music_track_id`, `spotify_track_id`, `youtube_music_track_id`, `amazon_music_track_id`, `lyric_url`, `track_review` — 既存の`TRACK_MERGE_FIELDS`と同一)が最も多い行
2. 同数の場合、`id`文字列比較で小さい方(決定的にするための最終手段)

選ばれなかった行を「重複行」と呼ぶ。album側も同様に、track本体が属するalbumを基準に、他の重複行が属するalbumを重複album候補として扱う(1グループ内で複数の異なるalbum_idに分散しているケースに対応するため)。

## track_artist / album_artist への統合

- 本体track行はそのまま(track.artist_idは変更しない。既存の全ページ・クエリが引き続き動作する)
- グループに関与した**全ての**artist_id(本体の元artist_idも含む)について、本体track行に対する`track_artist`行を作成する(既に存在する組み合わせは重複作成しない)
  - `role`: 本体の元artist_idには`'primary'`、それ以外には`'featuring'`
  - `billing_order`: 下記「表示順の決定」参照
- album側も同様に`album_artist`へ統合する
- 重複track行・重複album行は、フィールド補完(本体側がnullの項目を重複側の値で埋める。既存の`mergeMatchedTrack`と同じロジック)の後、`utils/fkRepoint.ts`の`repointForeignKeys`で参照元テーブルを本体側へ付け替えてから削除する
  - 参照元テーブルの一覧は、実装計画作成時に`information_schema`で機械的に再列挙すること(2026-09-12のアーティスト重複統合プロジェクトで確認済みの`TRACK_FK_REFERENCES`・`ALBUM_FK_REFERENCES`は同一スキーマのため流用できる可能性が高いが、必ず再確認する)

## 表示順(billing_order)の決定

1. track.titleから`(feat. A, B)`または`[feat. A, B]`パターンを正規表現で抽出できる場合、グループ内のアーティスト名のうち抽出結果に**含まれない**ものを`billing_order=1`(本体)とし、含まれるものを抽出順に`billing_order=2`以降とする
2. 抽出できない、またはグループ内のアーティスト名がどれも抽出結果と一致しない場合(シック/ナイル・ロジャースのような例)、上記「本体track/albumの選定」で選ばれた本体行の元artist_idを`billing_order=1`とし、残りは`track.artist_id`ベースの補完スコア(または単純にtrack数)が多い順、同数ならid文字列比較で決定的に並べる

この判定は表示順のみに影響し、データの完全性には影響しないため、あいまいな場合も人力確認フローは設けずベストエフォートで確定させる。

## 今後の再発防止(共通ガード)

実際のインポート処理(`app/admin/import/actions.ts`の`syncOneAlbum`)を確認したところ、根本原因はalbum単位にあることが分かった: `syncOneAlbum`はアルバムを**呼び出し元から渡された`artistId`で新規作成**し、収録トラックの既存判定を`apple_music_track_id` + `album_id`で行っている。フィーチャリング曲のalbumが既に**別のartist_idの下に別album行として**存在していても、この関数はそれを検知せず、常に新規album行(→新規track行)を作り直してしまう。つまりガードは**album作成の直前**に置く必要がある。

新規album行を作成する**全てのインポート経路**に、以下のガードを共通関数として追加する:

- 新規album作成前に、同一の`apple_music_album_id`を持つalbum行が**既に別のartist_idの下に存在するか**を確認する(apple_music_album_idが無い場合は`(title, track_count, release_date)`の完全一致でフォールバック判定する)
- 存在する場合は新規album行を作成せず、既存のalbum_idに対して現在同期中のartist_idの`album_artist`行を追加し、収録トラックの同期先も**その既存album_id**にする(結果として`syncOneAlbum`内の`apple_music_track_id` + `album_id`による既存トラック判定が正しく機能し、track側も重複を作らずに済む)
- 新規track行についても、apple_music_album_idを持たない手動登録経路等のために、`apple_music_track_id`(無ければtitle/track_no/durationの完全一致)による同種のガードを個別に用意する

さらに、track.titleが新規に`(feat. X)`パターンを含み、Xがまだ`artist`テーブルに存在しない場合:

- 既存の「名前のみの最小限スタブ」作成パターン(`import-nme-100.ts`等で使用中のもの)でXの空スタブを作成する
- 即座に該当trackへの`track_artist`行(`role='featuring'`)を追加する
- これにより、Xが後日独立して本格的なカタログ同期を受けた際も、上記ガードによって重複trackが作られることなく、既存のスタブ行がそのまま本登録(apple_music_artist_id付与)されるだけで済む

## 未マッチアーティスト管理画面の拡張

`/admin/data/artists/unmatched`は現在、`event_appearance_artist`と`ranking_entry`を起点とするスタブのみを一覧化している(全スタブを対象にすると無関係なMusicBrainz由来のスタブ等で埋もれてしまうため、意図的な絞り込み)。

今回のフィーチャリング経由で作成されるスタブ(`track_artist`経由)も、既存の絞り込みロジックに**第3のソース**として追加し、この管理画面から検索・本登録できるようにする。UIの構造自体は変更せず、対象取得クエリに`track_artist`テーブル経由のjoinを1つ追加するのみ。

## 安全確認(dry-runで必須報告する項目)

実行モードに進む前に、既存の重複統合プロジェクトと同じ運用(`--dry-run`既定・`--execute`)で、以下を必ずレポートに含める:

- 検出されたグループ数、関与するtrack行数・album行数
- 各グループの本体track_id/album_idと選定理由
- あいまいで未対応(同一artist_id内に完全一致行が複数)としてスキップされたグループの一覧
- 各グループで作成される`track_artist`・`album_artist`行数
- billing_orderがタイトル解析で決定できたか、フォールバックで決定したかの内訳
- 削除される重複track行・album行の件数、FK付け替えの件数
- 新規に作成される「フィーチャリング経由の空スタブ」アーティスト数

dry-runレポートを人間が確認し、明示的な承認を得てから実行モードを走らせる。

## 実行方式

- 新規スクリプト(例: `scripts/unify-track-artist-credits.ts`)を`--dry-run`(既定)・`--execute`の2モードで実行できるようにする
- 1グループの処理はtry/catchで区切り、1グループの失敗が他グループの処理を止めないようにする(既存の重複統合プロジェクトと同じ設計)
- 既存の`utils/artistDedupMatching.ts`・`utils/fkRepoint.ts`は可能な限りそのまま再利用し、新規ロジックは「グループ検出」「本体選定」「billing_order決定」「track_artist/album_artist作成」に限定する

## テスト・検証方針

- 重複統合プロジェクトと同様、DBマイグレーションスクリプトは自動テストの対象外とし、dry-run出力の人間による目視確認を基本とする
- ただし「グループ検出」「本体選定」「billing_order決定(feat.パターン解析)」は純粋関数として切り出し、ユニットテストを書く(既存の`utils/artistDedupCanonical.ts`・`utils/artistDedupMatching.ts`と同じ方針)
- 実行後の検証として、代表的な数グループについて: (a) track_artist/album_artistが正しく作成されていること、(b) 重複track/albumが削除されていること、(c) 該当アーティストページ・トラックページが正しく表示されることを直接確認する
