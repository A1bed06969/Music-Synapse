# アーティスト紹介文(bio)自動生成パイプライン 設計書

## 背景

music-synapseのアーティスト詳細ページは紹介文(`artist.bio`)を前提としたレイアウト(2026-09-08の詳細ページリニューアル)になっているが、実際には大半のアーティストで`bio`が空欄のままになっている。手動で全アーティストの紹介文を書くのは非現実的な量(17,000人超)なため、Geminiによる自動生成パイプラインを構築する。

v1のきっかけは藤井風の紹介文が既存386字→165字に手動で短縮・承認されたことで、これを「目標とする分量・トーンの実例」として以降の生成に使う。

対象は今回は**アーティストのbioのみ**。album_review/track_reviewの自動生成は同じ枠組みを想定できるが、v1のスコープには含めない。

## ゴール

- 選出・表彰(ランキングコンテンツへの掲載)を持つアーティストのうち、信頼できるソースが取得できる分について、150〜200字程度の紹介文を自動生成し即時公開する
- 生成に使う情報はすべて「取得元を追跡できる事実」に限定し、Geminiが自身の知識で内容を補完・創作することを防ぐ(ハルシネーション対策が最優先)
- 生成結果は目視レビューで事後に取り消せるようにする
- 費用は無料枠(Gemini `gemini-3.1-flash-lite`、500リクエスト/日)の範囲に収める

## 非ゴール

- album_review / track_reviewの自動生成(将来の別タスク)
- 既にbioが入っているアーティストの上書き・書き直し(実測で対象2,571人中2,569人はbio空欄、bio有りは2人のみのため、v1では「空欄を埋める」ことだけを考えればよく、上書きポリシーの設計自体が不要)
- ソースが見つからないアーティストへの無理な生成(後述の通り明示的にスキップする)

## 対象範囲とデータ可用性

「選出・表彰を持つアーティスト」= `ranking_entry`(直接のartist_id、またはalbum_id/track_id経由でひもづくartist_id)に一件以上登場するアーティスト。実測 **2,571人**、うちbio空欄が2,569人。

ソースの可用性(この2,571人に対して):

| ソース種別 | 該当人数 | 内容 |
|---|---|---|
| `ranking_article_context`あり | 695人 | NME100/Fender NEXTなどの元記事からすでに抽出済みのアーティスト紹介文断片 |
| Wikidataリンクあり(上記無し) | 290人 | `artist_external_link`に`wikidata.org`のリンクが登録済み。sitelink経由でWikipedia記事を解決できる |
| どちらも無し | 1,586人 | v1では生成対象外(スキップ) |

v1の生成対象は前2者、合計**986人**。

既存の分量サンプル(トーン・長さの校正用): Friction 178字、米津玄師 471字、Ado 384字、藤井風(短縮後) 165字。v1の目標は150〜200字。

## アーキテクチャ概要

既存のGemini照合パイプライン(パターンA: アーティストマッチング、パターンB: アルバムマッチング、パターンC: ラジオパワープレイマッチング)と同じ「Gemini無料枠 + リトライ/バックオフ + ログテーブルで追跡」という構成を、照合ではなく生成タスク向けに転用する。ただし照合タスクの確信度スコア(0.9以上で自動採用/0.5〜0.89でレビューキュー)という概念はここでは使わない。生成は成功/スキップ/エラーの3値のみを扱い、成功した生成物は即時公開する。

## コンポーネント設計

### 1. `utils/wikidata.ts`の拡張

既存の`searchWikidataEntity`/`fetchOriginCoordinates`に加え、以下を追加する。

```ts
export async function fetchWikipediaSitelink(
  qid: string
): Promise<{ lang: 'ja' | 'en'; title: string } | null>
```

Wikidataの`wbgetentities`(`props=sitelinks`)を呼び、`jawiki`があればja、無ければ`enwiki`があればenのタイトルを返す。どちらも無ければ`null`。

### 2. 新規 `utils/wikipediaArticle.ts`

既存`utils/wikipediaGenre.ts`の`fetchWikitext(lang, title)`(`action=parse&prop=wikitext&section=0`で冒頭セクションを取得する仕組み)をそのまま再利用し、取得したwikitextを平文化する関数を追加する。

```ts
export async function fetchWikipediaLeadText(
  lang: 'ja' | 'en',
  title: string
): Promise<string | null>
```

内部で`fetchWikitext(lang, title)`を呼び、`[[リンク|表示]]`→表示、`'''強調'''`→除去、`{{テンプレート}}`→除去、といった軽量なwikitextクレンジングを行い、プレーンな文章にして返す。パースに失敗した場合は`null`。

### 3. 新規 `utils/geminiBioGenerate.ts`

```ts
export type BioGenerationFacts = {
  artistName: string
  genreNames: string[]
  formedYear: number | null
  originPrefecture: string | null
  hometownCity: string | null
}

export type BioGenerationResult =
  | { status: 'generated'; bio: string }
  | { status: 'declined' } // Geminiが「情報不足で安全に書けない」と判断

export async function generateArtistBioWithGemini(
  facts: BioGenerationFacts,
  sourceText: string,
  sourceType: 'article_context' | 'wikidata'
): Promise<BioGenerationResult>
```

既存の`geminiRadioPickMatch.ts`等と同じMAX_ATTEMPTS=5・指数バックオフのリトライ構成を流用する。プロンプトの骨子:

- 「以下の事実とソーステキストに書かれている内容だけを使い、150〜200字程度の日本語紹介文を書いてください」
- 「ソーステキストに書かれていない情報を絶対に追加しないでください。推測や一般的な形容だけで補わないでください」
- 文体サンプルとして藤井風の短縮版など既存bio 2〜3件をfew-shotで提示
- ソーステキストが薄すぎて安全な紹介文を書けない場合は所定の文字列(例: `INSUFFICIENT`)のみを返すよう指示し、コード側で`{ status: 'declined' }`に変換

### 4. 新規テーブル `bio_generation_log`

```sql
create table bio_generation_log (
  id text primary key default ('BGL' || substr(md5(random()::text), 1, 8)),
  artist_id text not null references artist(id),
  artist_name text not null,
  source_type text not null, -- 'article_context' | 'wikidata'
  source_excerpt text not null,
  previous_bio text,
  generated_bio text,
  status text not null, -- 'applied' | 'skipped_no_source' | 'skipped_declined' | 'error'
  created_at timestamptz not null default now()
);
```

既存のパターンA/B/C(`radio_pick_match_log`等)と同じ、prefix付きID・監査ログの命名慣習に合わせる。

### 5. 新規 `scripts/generate-artist-bios.ts`

- `ranking_entry`(album_id/track_id経由含む)から優先アーティスト集合を作り、各アーティストの選出・表彰件数を数えて件数の多い順に並べる
- bioが空欄かつ`bio_generation_log`にまだ`applied`の記録が無いアーティストのみを対象にする
- 各アーティストについてソース解決 → Gemini呼び出し → 成功時は`artist.bio`を更新し`biography_status`を`'GENERATED'`に設定、`safeRevalidatePath`でアーティストページを再検証、`bio_generation_log`に記録
- `--limit=N`引数で1回の実行件数を制御(既存スクリプト群と同じ慣習)。無料枠(500件/日)を踏まえ、既存の`verify-radio-pick-matches.ts`と同様に日次cronでの継続実行を想定
- `revalidatePath`のみを使うため(`after()`は不要)、既存スクリプト群と異なりCLIから直接Supabaseを叩く形で問題ない。内部APIルート経由にする必要は無い

### 6. 新規管理画面 `app/admin/data/artists/bio-generation/page.tsx`

`bio_generation_log`から`status='applied'`の行を新しい順に一覧表示し、各行にアーティスト名・生成文・生成日時を表示。「取り消す」ボタンを押すと以下を行うサーバーアクション(`revertBioGeneration(logId)`)を呼ぶ:

- `artist.bio`を`previous_bio`(空文字列)に戻す
- `artist.biography_status`を`'REVERTED'`に設定
- ログ行の`status`を`'reverted'`に更新
- `safeRevalidatePath`でページを再検証

## データフロー(1アーティストあたり)

1. `artist_genre`→`genre`でジャンル名一覧、`formed_year`/`origin_prefecture`/`hometown_city`など既知の構造化事実を集める
2. ソース解決: `ranking_article_context`に該当アーティスト名のエントリがあればそれを`sourceText`として使用(`source_type='article_context'`)。複数エントリがある場合は最も長いものを採用。無ければ`artist_external_link`のwikidataリンクからQIDを取り出し、`fetchWikipediaSitelink`→`fetchWikipediaLeadText`でリード文を取得(`source_type='wikidata'`)。どちらも取得できなければ`bio_generation_log`に`status='skipped_no_source'`を記録して次のアーティストへ
3. `generateArtistBioWithGemini(facts, sourceText, sourceType)`を呼ぶ
4. `status: 'declined'`の場合、`bio_generation_log`に`status='skipped_declined'`を記録して次へ
5. `status: 'generated'`の場合、`artist.bio`を更新、`biography_status='GENERATED'`、`bio_generation_log`に`status='applied'`(`previous_bio`は更新前の値=空文字列、`generated_bio`は新文)を記録、`safeRevalidatePath(`/artists/${id}`)`

## エラーハンドリング

- Gemini 429/503: 既存パターンと同じ5回リトライ+指数バックオフ。それでも失敗したら`bio_generation_log`に`status='error'`を記録し、その日はそこで打ち切って翌日分に持ち越す(残りは未処理のまま残るので次回実行時に自然に再挑戦される)
- Wikipedia/WikidataのAPI呼び出し失敗: そのアーティストは`skipped_no_source`として扱う(生成をブロックしない)
- 1日の無料枠(500件)は`--limit`で制御し、既存の日次cronの運用パターンをそのまま踏襲する

## 公開・取消フロー

生成成功は即時に`artist.bio`へ反映・公開する(合意済み方針)。誤りや不自然な文章は管理画面で目視確認し、「取り消す」で即座に空欄へロールバックできる。取り消し後、そのアーティストは`bio_generation_log`に`applied`の記録が残っていない状態になるため、次回のバッチ実行で自動的に再度生成対象になる(同じ理由で誤生成を繰り返さないよう、`biography_status='REVERTED'`のアーティストはバッチの対象から除外する)。

## テスト方針

- ユニットテスト:
  - ソース解決の優先順位ロジック(article_context有無→wikidata有無→スキップ)
  - `fetchWikipediaLeadText`のwikitextクレンジング(リンク記法・強調記法・テンプレートの除去)
  - Geminiの`INSUFFICIENT`宣言のハンドリング
- 手動確認: 本番バッチの前に藤井風を含む主要アーティスト数名で試し打ちし、生成文を目視確認してから本走行に進める

## 関連する別課題(スコープ外)

- album_review / track_reviewの自動生成(同じ枠組みを将来使う想定だが、v1では扱わない)
- ソースが見つからない1,586人への対応(素のWikipedia名前検索など、名前の曖昧性解消が課題になるため別途検討)
- 既にbioが入っているアーティストの再生成・上書きポリシー(v1では対象がほぼ皆無のため設計不要だが、将来bioの多くが埋まった後に「古い/薄いbioを書き直す」需要が出た場合は再検討が必要)
