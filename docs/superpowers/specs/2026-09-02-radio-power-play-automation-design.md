# ラジオ局パワープレイ/ヘビーローテーション自動収集 設計

## 背景

Music Synapseは65局以上のラジオ局のパワープレイ/ヘビーローテーション(以下PP)を`media` / `media_program` / `radio_rotation`に保持しているが、このデータはユーザー自身が毎月手作業でまとめていたスプレッドシート(HRPPシート)を`scripts/import-hrpp-radio-picks.ts`で一括投入したもの(最新は2026-08-01時点)。9月に入り各局の選曲が一新されたが未反映であり、この手作業を継続する限り毎月同じ負担が発生する。

既存資産の調査で、以下がすでに存在することを確認済み:

1. **3局限定の正規表現スクレイピングパイロット** — `app/admin/data/media/radio-pilot` + `utils/radioScrape.ts`(J-WAVE SONAR TRAX・FM福井 Heavy Rotation・FMノースウェーブ MEGA PLAY/POWER PUSH)。コード内コメントに「サイト構造がバラつく局が増えたらLLM抽出(Haiku等)に切り替える想定」と明記されている。
2. **フェス出演者収集向けの完成したGemini抽出パイプライン** — `utils/geminiFestivalLineupExtract.ts`。HTML取得→visible text抽出→`gemini-3.1-flash-lite`への構造化抽出(JSON `RESPONSE_SCHEMA`)→429/503リトライ、という一連の流れがすでに動いている。このファイル自身のコメントが「ラジオ局PP収集と同じ方針でLLM抽出を採用しつつも」と述べており、この設計は元々ラジオPP収集への転用を見越して作られたもの。
3. **人力確認込みの登録フロー** — `radio_airplay_pick`テーブル(スクリプト`backfill-radio-pick-itunes-candidates.ts`でApple Music候補を自動マッチ)+ 管理画面`/admin/data/media/radio-airplay-pick`(未マッチ/マッチ済み/本登録済みの3ビュー、人力確認してからカタログ登録)。

未解決だったのは「65局中62局(パイロット以外)分のPPページURLをどう入手・保存するか」で、`media`テーブルにURL列が存在せず、ユーザー提供のGoogleシートも局名・地域の一覧のみでURLは含まれていなかった。

ブレインストーミングで確認済みの方針:

1. **URL収集**: Claudeが各局のサイト/SNSをWeb検索してURLを埋める。見つからない局は空のままにし、既存の手動運用(HRPPシート経由の一括投入)にフォールバックする。
2. **実行タイミング**: Vercel Cronで自動定期実行。各局の更新日はバラバラなため、月1回ではなく**毎週**実行して差分を拾う方式とする。
3. **人力確認の範囲**: 既存方針(全件人力確認)を維持する。Apple Music候補のマッチングまでは自動、カタログへの本登録(`registerPickToRotation`)は必ず人が確認してから。抽出そのものの信頼度によって自動本登録を分岐させることはしない。

## ゴール

- `media`に各局のPPページURLを保存できるようにし、Claudeが調査した分をあらかじめ登録しておく
- URLが登録されている局について、Gemini構造化抽出で汎用的に(サイト構造を問わず)PP選曲を取得できる汎用抽出ユーティリティを作る
- 毎週自動実行され、抽出結果を既存の`radio_airplay_pick`テーブルへ登録するAPIルート(Vercel Cronから起動)を作る
- 既に確立している人力確認フロー(`/admin/data/media/radio-airplay-pick`)にそのまま合流させ、新しい確認画面は作らない
- 同じ選曲を毎週重複登録しないよう、直近の登録済みデータと突き合わせて差分のみを追加する

## 非ゴール

- URLが見つからなかった局の自動化(引き続き手動のHRPPシート運用に頼る。将来URLが見つかり次第、`power_play_url`を埋めれば自動化対象に加わる設計にする)
- 3局パイロット(`radioScrape.ts`)の置き換え・統合(正規表現方式は精度が高く動作実績があるため残す。汎用LLM抽出は「それ以外の局」を対象とする、別レーンとして共存させる)
- Apple Music候補マッチングの精度改善(既存の`searchTracks`ベースのロジックをそのまま使う)
- 抽出結果の自動カタログ登録(常に人力確認を経由する)
- SNS(X/Instagram等)からの抽出(ログイン・レート制限の壁が高く別スコープとする。まずは局の公式サイトのみ)

## データモデル

### `media`テーブルへのカラム追加

```sql
alter table media add column power_play_url text;
```

- nullable。パイロット3局を含め、URLが判明した局から順に埋める。
- 1局が複数のPP系企画(パワープレイ+ヘビーローテーション等)を持つ場合も、まずは主要な1URLに絞る(`media_program`側で企画名を分けて記録する既存の仕組みと役割分担する)。

### 既存テーブルの再利用(変更なし)

`radio_airplay_pick`(列: `id, region, station_name, campaign_name, picked_date, artist_name, track_title, is_domestic, candidate_track_id, candidate_track_name, candidate_artist_name, candidate_collection_id, candidate_collection_name, candidate_artwork_url, created_at`)にそのままinsertする。抽出元が「手動HRPPシート」か「自動収集」かを区別する列は追加しない(区別が必要になった場合の拡張ポイントとして`campaign_name`に自動収集分は局のPPページ上の企画名をそのまま入れる)。

## コンポーネント設計

### 1. `utils/geminiRadioPickExtract.ts`(新規)

`utils/geminiFestivalLineupExtract.ts`と同じ構造を踏襲する:

```ts
export type RadioPickCandidate = {
  artistName: string
  trackTitle: string
  campaignName: string | null // 「パワープレイ」「ヘビーローテーション」等、ページ上で判別できれば
}

export async function extractRadioPicksFromUrl(
  stationName: string,
  url: string
): Promise<RadioPickCandidate[]>
```

内部処理:
1. `fetch(url)`でHTML取得(タイムアウト15秒、User-Agent指定は既存の`fetchOgImage`等と同じ慣習に合わせる)
2. `utils/geminiFestivalLineupExtract.ts`が既にexportしている`stripHtmlToText`をそのままimportして本文テキストに変換(複製しない)
3. Gemini `gemini-3.1-flash-lite`に、局名を含めたプロンプトと`RESPONSE_SCHEMA`(`artistName` / `trackTitle` / `campaignName`の配列)を渡して構造化抽出
4. 429/503は`geminiFestivalLineupExtract.ts`と同じリトライロジックを流用
5. 取得0件・HTTPエラー・パース失敗はすべて空配列を返す(呼び出し側でスキップしログに残す。例外を投げて全体を止めない)

### 2. `app/api/cron/radio-power-play/route.ts`(新規)

```ts
export const maxDuration = 300 // 65局分の逐次抽出を見込む
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  // ...
}
```

このプロジェクトにはcronルート・`CRON_SECRET`のような認証パターンがまだ存在しないため、Vercel公式のCron保護方式(`Authorization: Bearer $CRON_SECRET`、Vercel Cronからのリクエストには自動的にこのヘッダーが付与される)を新規に採用する。実装時にVercelプロジェクトの環境変数へ`CRON_SECRET`を追加する作業が必要(値はランダムな文字列を生成して設定する)。

**重要な前提の修正(plan作成時に判明)**: `proxy.ts`がサイト全体(全APIルート含む)をBasic認証で保護しており、`Basic `以外のAuthorizationヘッダーは無条件に401を返す。Vercel Cronは`Bearer $CRON_SECRET`ヘッダーを送るため、このミドルウェアを素通りできず、cronルートに到達する前に必ず401でブロックされてしまう。そのため`proxy.ts`の`config.matcher`から`/api/cron/`配下を除外する変更が必須になる。Basic認証を外す分、ルート自体の`CRON_SECRET`検証が唯一の防御になるため、この検証は必須(オプションではない)。

処理内容:
1. `media`から`power_play_url is not null`の局を全件取得
2. 各局について`extractRadioPicksFromUrl`を呼び、成功した候補を受け取る
3. 各候補について、**今月分**の`radio_airplay_pick`に同一`station_name` + `artist_name` + `track_title`が既に存在するかチェックし、存在しなければinsert(重複防止、詳細は次節)
4. 新規にiTunes候補が未設定の行に対し、`backfill-radio-pick-itunes-candidates.ts`と同じロジック(`searchTracks`)でApple Music候補を即座に付与する(既存スクリプトの关数を`utils/`に切り出して共有する)
5. 局ごとの成功/失敗件数をレスポンスJSONで返す(Vercel Cronのログで確認できるようにする)

### 3. `vercel.json`(新規)

```json
{
  "crons": [
    { "path": "/api/cron/radio-power-play", "schedule": "0 21 * * 1" }
  ]
}
```

JSTで毎週火曜6:00(UTC 21:00月曜)に実行(既存の日次バッチが無いため、深夜〜早朝で低負荷な時間帯を選ぶ。曜日は初期値、後から調整可能)。

### 4. `scripts/backfill-radio-station-urls.ts`(新規、一度きりの手動実行スクリプト)

Claudeが調査したURLを`media.power_play_url`へ書き込むための、シンプルな「局名→URL」マッピング配列を受け取ってupdateするスクリプト。調査自体はスクリプトの外(Web検索)で行い、結果をこのスクリプトのマッピング定数に埋め込んで一度実行する。

### 5. 既存コンポーネントの変更点

- `backfill-radio-pick-itunes-candidates.ts`のApple Music検索ロジックを`utils/radioPickMatching.ts`(新規)に切り出し、スクリプトと新しいcronルートの両方から呼べるようにする(重複実装を避ける)。
- `/admin/data/media/radio-airplay-pick`・`radio-pilot`は変更しない。

## データフロー

```
[Vercel Cron: 毎週]
  → GET /api/cron/radio-power-play
    → media (power_play_url is not null) を全件取得
    → 各局: extractRadioPicksFromUrl(stationName, url)
      → HTML取得 → visible text化 → Gemini構造化抽出 → 候補配列
    → 各候補: 今月分の重複チェック → 新規のみ radio_airplay_pick へ insert
    → 新規行に Apple Music 候補を自動付与(searchTracksベース)
  → レスポンス: 局ごとの成功/失敗/新規件数
[人(ユーザー)]
  → /admin/data/media/radio-airplay-pick で確認
    → 未マッチ: 手動検索 or URL貼り付けで候補設定
    → マッチ済み: 内容を見て「登録」→ カタログ反映(既存の registerPickToRotation)
```

## 重複防止(冪等性)

局のページは毎週再取得するが、局が更新していない週は同じ選曲が再抽出される。挿入前に以下の条件で既存行を確認し、あれば挿入をスキップする:

```ts
const { data: existing } = await supabase
  .from('radio_airplay_pick')
  .select('id')
  .eq('station_name', stationName)
  .ilike('artist_name', candidate.artistName)
  .ilike('track_title', candidate.trackTitle)
  .gte('created_at', firstDayOfCurrentMonthISO)
  .maybeSingle()
if (existing) continue // 今月すでに記録済み
```

月が変わった時点で「先月と同じ選曲がまだ続いている」場合は新しい月の1件として改めて記録される(HRPPシートの手動運用でも月ごとに記録し直していたため、既存の実績データの粒度と一致する)。

## エラーハンドリング

- 局のfetchが失敗(タイムアウト・4xx/5xx・DNS失敗等)しても、その局だけスキップして他局の処理を続ける(1局の不調で全体を止めない、`radio-pilot`の設計と同じ思想)。
- Geminiのレスポンスがスキーマに合わない・パース失敗の場合も同様にスキップしログに残す。
- iTunes候補検索のレート制限(403/429)は`backfill-radio-pick-itunes-candidates.ts`と同じ60秒クールダウン方式を踏襲する。
- cronルート全体がタイムアウト(Vercel Cronの実行時間上限)に達した場合に備え、局のループは早い段階で失敗したものをログに残しつつ次に進む実装とし、部分的成功でも構わない設計にする(次週の実行で自然にリトライされる)。

## テスト方針

- `extractRadioPicksFromUrl`は実際のGemini呼び出しをモックしたユニットテストで、HTML→候補配列の変換ロジック(特にJSON解析・空配列フォールバック)を検証する。
- cronルートは、Supabaseをモックした結合テストで「重複はスキップされる」「新規は挿入される」ことを検証する。
- 本番相当の検証は、URLを数局分だけ登録した状態で手動フルリクエスト(`curl`)を叩き、`radio_airplay_pick`に想定通り入るか確認してから、Vercel Cronの有効化・全局展開に進む。

## 段階的ロールアウト

1. `media.power_play_url`列を追加。
2. Claudeが局のサイトを調査し、判明した分だけURLを埋める(65局中何局埋まるかはやってみないと分からない。一度に全て終わらない場合は複数回に分けて拡充する)。
3. `geminiRadioPickExtract.ts` / cronルートを実装し、まずURLが埋まった数局だけで手動実行して精度を確認する。
4. 問題なければVercel Cronを有効化し、以降は毎週自動実行に移行する。
5. URLが埋まっていない局は、これまでどおりHRPPシート経由の手動投入を継続する(このワークフロー自体は変更しない)。
