# ②キュレーション情報 登録手順

**位置づけ**: [data-registration-guidelines.md](./data-registration-guidelines.md)の優先順位②にあたる作業の具体的な実行手順。「Gemini支援マッチング」の仕組みは既に実装済み(2026-09-04/05)であり、**新規実装は不要**。本ドキュメントはそれを使って実データの未マッチ分を解消するための運用手順を定める。

## ①パワープレイとの違い

①は「毎月繰り返す常時収集」だったのに対し、②は**企画(NME 100、タワレコメン等)ごとに一度マッチングを完了させたら基本的に触らない**性質の作業。各企画のロースター自体は`scripts/import-*.ts`にハードコードされているか、ユーザー提供のスプレッドシート/CSVに基づく一度きりのインポートで、常時自動収集するものではない。

**重要**: これらのインポートスクリプトはどれも「insert-if-not-exists」で再実行安全な設計。ロースター自体がスクリプト/CSVの中に静的に保持されているため、本番復旧・ローカル再構築のどちらになっても、外部サイトへ再アクセスすることなく同じスクリプトを再実行するだけで同じキュレーションデータを再現できる。

## 対象企画と2つの系統

| 企画 | 種別 | マッチングUI |
|---|---|---|
| The NME 100 | アーティスト単体 | `/admin/data/artists/unmatched` |
| Fender NEXT | アーティスト単体 | 同上 |
| Future of Music | アーティスト単体 | 同上 |
| RADAR: Early Noise | アーティスト単体 | 同上 |
| タワレコメン | アルバム | `/admin/data/curation/{ranking_id}/match` |
| これは聴いておきたい不滅の名盤(TSUTAYA meiban) | アルバム | 同上 |
| Rolling Stone 500 | アルバム | 同上 |

両系統とも同じ設計思想: Geminiが確信度を判定し、**0.9以上で自動反映**、**0.5〜0.89で要確認キュー**に回し、**0.5未満は判別材料が無いとみなして手動検索フォールバック**に残す(同名多数で無理に採用しない設計)。

### `/admin/data/artists/unmatched`の注意点

このページは**キュレーション企画だけでなく、フェス出演者(③のスコープ)・フィーチャリング参加者の未マッチスタブも同じ一覧に混在する**(`event_appearance_artist` / `ranking_entry` / `track_artist(role='featured')`の3系統が同じプールに入る)。

- 「Geminiで自動判定」ボタンは企画(`ranking`)ごとにグループ化されているため、②の作業中に押す分には自動的にキュレーション分だけが対象になる
- 一方、要確認キュー・手動検索一覧は3系統が混ざって表示される。②の作業では、行の「キュレーション: 〈企画名〉」というコンテキスト表示があるものだけを対象にし、「出演: 〈イベント名〉」表示の行は③フェス情報の作業まで触らない

## 現在の状況(2026-09-04/05時点の記録。着手前に必ず再確認すること)

| 企画 | インポート | マッチング未処理(記録時点) |
|---|---|---|
| The NME 100 | 済み | 196件、Gemini一括判定は未実行 |
| Fender NEXT | 済み | 45件、同上 |
| Future of Music | 済み | 2件、Geminiパイプライン未構築(要件数が少なく後回し) |
| RADAR: Early Noise | 済み | 1件、同上 |
| タワレコメン | 済み | 件数未確認、Gemini一括判定は未実行 |
| これは聴いておきたい不滅の名盤 | 済み | 件数未確認、同上 |
| Rolling Stone 500 | 要確認 | 未確認 |

この記録は約2週間前のもので、その後の作業(誤マッチ修正・DB障害等)による影響は未検証。**Step 1で必ず最新値に更新すること。**

## 完了条件

> `ranking`テーブルの全企画についてインポートが完了し、かつ`/admin/data/curation`の各企画の「要マッチング」件数と、`/admin/data/artists/unmatched`のうち「キュレーション: 」タグが付いた未マッチ件数が、いずれも0件になったら②は完了とする。

- Future of Music・RADAR: Early Noiseのように、まだGeminiパイプラインが無い企画は、Step 4の手動確認で0件にするか、次回のロースター更新まで意図的に据え置くかを都度判断してよい(据え置く場合はその旨を記録する)

## 手順

### Step 1: 状況確認・未インポート分のインポート

1. `/admin/data/curation`で`ranking`一覧と各企画の「要マッチング」件数を確認し、上記の記録表と比較する
2. 未インポートの企画があれば該当スクリプトを実行する
   ```bash
   npx tsx --env-file=.env.local scripts/import-nme-100.ts
   npx tsx --env-file=.env.local scripts/import-fender-next.ts <csvのパス>
   npx tsx --env-file=.env.local scripts/import-radar-early-noise.ts
   npx tsx --env-file=.env.local scripts/import-future-of-music.ts
   ```
3. タワレコメン・不滅の名盤・Rolling Stone 500は`register-album`エンドポイント(内部で`after()`を使用)を叩くため、**`npm run dev`でローカルサーバーを起動した状態で**実行する
   ```bash
   npx tsx --env-file=.env.local scripts/import-towerecomen.ts <jsonのパス>
   npx tsx --env-file=.env.local scripts/import-tsutaya-meiban.ts <csvのパス>
   npx tsx --env-file=.env.local scripts/import-rolling-stone-500.ts <csvのパス>
   ```

### Step 2: アーティスト単体の企画をマッチングする(NME 100 / Fender NEXT)

1. `/admin/data/artists/unmatched`を開く
2. 企画ごとの「Geminiで自動判定」を一括実行する
3. 要確認キューは、ガイドラインのルール2(検索結果を機械的に採用しない)に従い、記事コンテキスト(出身地・似ているアーティスト・代表曲)と候補の実カタログ(初リリース年・アルバム名)を見比べてから採用/却下する
4. 自動判定にも要確認キューにも乗らなかった残りは、手動検索で候補を設定する(「キュレーション: 〈企画名〉」タグの行のみ対象にする)

### Step 3: アルバム単体の企画をマッチングする(タワレコメン / 不滅の名盤 / Rolling Stone 500)

1. `/admin/data/curation`から各企画の「要マッチング」リンクを開く
2. `GeminiAlbumMatchPanel`で一括判定を実行する(閾値・要確認キューの扱いはStep 2と同じ)
3. Geminiは「アーティスト名が明確に一致しない場合、類似度スコアが高くても信用しない」設計になっている(過去のTSUTAYA不滅の名盤『Prince 1999』誤マッチの教訓を反映済み)。要確認キューはこの観点で目視確認する

### Step 4: Geminiパイプライン未構築の企画(Future of Music / RADAR: Early Noise)

未マッチ件数が小さいうちは、`/admin/data/artists/unmatched`の手動検索で1件ずつ確認・登録する(「キュレーション: Future of Music」「キュレーション: RADAR: Early Noise」タグの行)。次回のロースター更新で未マッチ件数がまとまった量になったら、NME 100と同じ仕組み(`ranking_source_url` + `ranking_article_context` + `utils/geminiArticleContextExtract.ts`)を構築することを検討する(現時点では費用対効果が低いため据え置き)。

### Step 5: 完了確認

完了条件を満たしているか確認する。満たしていれば②は完了とし、③フェス情報に進む。

## 備考

- 新しい企画をこのカテゴリーに追加する場合も、既存の2系統(アーティスト単体/アルバム)のどちらかにそのまま乗せられるかをまず確認してから着手する
- `/admin/data/artists/unmatched`はフェス出演者(③)とも共有のページのため、②の作業中に③のスタブまで一緒に処理しないよう注意する(逆に③の作業をするときは②側のキュレーションタグの行に手を出さない)
