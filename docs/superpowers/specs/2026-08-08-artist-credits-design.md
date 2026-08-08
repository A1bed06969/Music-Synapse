# アーティストのクレジット情報(プロデューサー・スタッフ等)収集 設計

## 背景

アーティストの制作クレジット(プロデューサー・ミックス・マスタリング・作曲・作詞・編曲・アートワーク等)を、MusicBrainzとDiscogsから収集して反映したい。既存の`artist_relation`テーブルはアーティスト同士の関係(membership/production/collaboration/genre_scene/influence/sync_costar)のみを表現しており、`artist`テーブルに行を持たない人物(プロデューサーなど、このDBのカタログに載っていない人)をクレジットとして扱う仕組みが無い。

なお、当初「既存の12時間同期ジョブに1本足すだけ」という想定だったが、調査の結果そのようなスケジュールジョブ(GitHub Actions/Vercel cron/Supabase Edge Function等)は実際には存在しないことを確認済み。このアプリの外部データ収集(MusicBrainz連携・iTunesバルク登録・コラボアーティスト発見)は全て「管理画面から手動トリガー」という方式で統一されており、今回もこのパターンを踏襲する。

**実データ検証で判明した重要な事実**: 当初「`fetchArtistDetails`の`inc`に`artist-rels`を追加すればproducer/mix/mastering等が取れる」という想定だったが、King Gnu・Rick Rubin等の実データで検証した結果これは誤りだった。MusicBrainzの`inc=artist-rels`(アーティスト同士の直接的な関係)には`member of band`のような人間関係しか含まれず、制作クレジットは含まれない。制作クレジットは**リリース(アルバム)単位のデータ**であり、`GET /release/{id}?inc=artist-rels`のように個々のリリースへ問い合わせて初めて取得できる(Rick RubinがBlood Sugar Sex Magikのproducerである、という情報はこの経路で確認済み)。King Gnu1アーティストだけでMusicBrainz上に73リリース(地域違い等含む)あり、全リリースを1req/秒の制限下で総当たりするのは非現実的なため、取り込みの起点を「アーティスト単位」から「アルバム単位」に変更する。

## ゴール

- アーティスト編集ページに表示されるそのアーティストのアルバム一覧から、アルバムごとに「クレジットを取り込む」を実行できるようにする
- MusicBrainzでアルバムタイトルから対応するリリースを検索・確認した上で、そのリリースの制作クレジット(プロデューサー等)を取得し、プレビュー確認の上で取り込めるようにする(Discogsは後続タスク)
- クレジット対象人物が既にこのDBに登録済みのアーティストである場合(例: Yaffleが他アーティストの作品をプロデュースしているケース)は、新しい人物として重複登録せず、既存の`artist_relation`(アーティスト間関係)に反映する
- クレジット対象人物がこのDBに未登録の人物である場合は、新しいエンティティ(`credit_person`)として登録し、`artist_relation`とは別の新テーブル(`artist_credit`)で関係を表現する。どのアルバムのクレジットかも記録する
- 相関図(`RelationGraph`)にクレジット人物のノードを表示し、クリックするとその人物の全クレジット一覧ページに遷移できるようにする

## 非ゴール

- 定期実行の自動収集(スケジュールジョブ)。今回も既存パターン通り、手動トリガー
- MusicBrainzの全リリースを総当たりで自動巡回すること。1回の実行は管理者が選んだ1アルバム分のリリースに対してのみ行う
- 演奏楽器別クレジット(ギター・ドラム等performer系)の取り込み。役割は主要7種類(producer/mix/mastering/composer/lyricist/arranger/artwork)に絞る
- MusicBrainzのWork(楽曲)単位の関係性を追いかけること。lyricist等、Work単位でしか管理されていないクレジットの欠落は既知の制限として受容する(詳細は「データモデル」内の役割の正規化を参照)
- 同姓同名の人物を高精度に名寄せする仕組み。MBID/Discogs IDが無い場合は名前の完全一致のみで判定し、誤判定のリスクは人間の確認プロセスに委ねる
- `credit_person`の編集UI(削除・統合等)。今回は取り込みと表示のみ
- Discogsの実装は、MusicBrainz分が完成した後の後続タスクとして扱う(設計・スキーマは両ソース共通で今回まとめて決めるが、実装順序は段階的にする)
- アルバム単体の汎用管理画面(`/admin/data/albums/[id]/edit`のようなもの)を作ること。今回はクレジット取り込み専用ページのみ新設する

## データモデル

```sql
credit_person (
  id text primary key default generate_ms_id('CRP'),
  name text not null,
  musicbrainz_id text,  -- MBID、null可
  discogs_id text,      -- Discogs Artist ID、null可
  created_at timestamptz not null default now()
)
-- 重複防止: musicbrainz_id・discogs_idそれぞれにunique制約(null許容のunique index)。
-- nameには一意制約を付けない(同姓同名が実在しうるため)。

artist_credit (
  id text primary key default generate_ms_id('ACR'),
  artist_id text not null references artist(id),
  album_id text references album(id),  -- どのアルバムのクレジットか(取得元)。null許容
  credit_person_id text not null references credit_person(id),
  role text not null,   -- 'producer' | 'mix' | 'mastering' | 'composer' | 'lyricist' | 'arranger' | 'artwork'
  source text not null, -- 'musicbrainz' | 'discogs'
  source_url text,      -- 出典URL(MusicBrainzのrelease URLやDiscogsのリリースページ等)、無ければnull
  created_at timestamptz not null default now()
)
-- unique(artist_id, album_id, credit_person_id, role, source) で再取込み時の重複を防ぐ。
-- album_idを含めることで、同じ人物が複数アルバムで同じ役割を持つ場合、アルバムごとに
-- 別の実績として記録される(/people/[id]で「このアルバムとこのアルバムを担当」と表示可能)。

-- 既存artistテーブルへの追加列(クレジット対象人物が「既に登録済みアーティストか」を
-- MBIDで判定するために必要。今回のMusicBrainz取り込み実行時に併せて保存する):
alter table artist add column musicbrainz_id text;
-- unique index (null許容)

-- 既存artist_relationテーブルへの追加(重複防止。現状インデックスが無く、
-- 本機能が書き込むことで重複行が生じるリスクがあるため今回併せて追加する。
-- こちらはartist_creditと違いアルバム単位の粒度を持たせず、既存の意味合い
-- 「アーティストペアの関係」のまま、アーティストペア単位で重複防止する):
create unique index artist_relation_dedup_key on artist_relation (artist_id_a, artist_id_b, relation_type);
-- 適用前に既存データに重複が無いことを確認する
```

役割(role)の正規化: MusicBrainzのリリースrelationとDiscogsのクレジット欄はそれぞれ独自の表記(例: MusicBrainzの`producer`、Discogsの`Producer`/`Executive-Producer`)を持つため、取り込み時に上記7種類のいずれかへマッピングする許可リスト方式とする。対応しない役割(演奏楽器別クレジット等)は取り込み対象外(MusicBrainzリンク種別の絞り込みと同じ方針)。MusicBrainz側の実際のtype文字列は実データで確認済み: `producer`→producer, `mix`→mix, `mastering`→mastering, `composer`→composer, `arranger`→arranger, `design/illustration`→artwork, `lyricist`→lyricist(文字列としては標準だが実データでの出現は未確認)。

**既知の制限(データソース側の制約)**: MusicBrainzでは作詞(lyricist)クレジットの多くが「Work(楽曲そのものを表す抽象エンティティ、個々のリリースとは別物)」単位で管理されており、今回採用するリリース単位の取得方法(`release`エンティティへの`inc=artist-rels`)では拾えないことを実データで確認済み(日本で最も著名な作詞家の一人、秋元康の実データで、production関連は取得できるがlyricistは1件も無いことを確認)。composer/arrangerは稀にリリース単位でも取得できる(John Williamsの実データで確認)。Work単位まで追いかければ完全に取得できるが、リリース→収録曲一覧→各曲のWork→関係性という追加のAPI呼び出し(1アルバムあたり数十秒〜数分規模)が必要になるため、今回は実装しない。取得できるものだけ取り込み、lyricist等の欠落は既知の制限として受容する。

## アーキテクチャ

```
migration:
  - credit_person テーブル新規作成
  - artist_credit テーブル新規作成
  - artist.musicbrainz_id 列追加(unique index)
  - artist_relation に unique(artist_id_a, artist_id_b, relation_type) 追加

utils/musicbrainz.ts (既存に変更)
  └─ 新規: searchRelease(title: string, artistName: string) -> { mbid, title, date, country }[]
     (リリース検索。GET /release?query=... で候補を返す)
  └─ 新規: fetchReleaseCredits(releaseMbid: string) -> { personName, personMbid, role, sourceUrl }[]
     (GET /release/{id}?inc=artist-rels を取得し、主要7役割にマッピングできるものだけ抽出)
  └─ importMusicBrainzData(既存アクション)を変更し、取り込み時にartist.musicbrainz_idも保存する

utils/discogs.ts (新規、Discogsタスクで実装)
  └─ 認証・検索・クレジット取得のクライアント

app/admin/data/albums/[id]/credits/page.tsx (新規)
  └─ アルバムタイトルでMusicBrainzリリースを検索→候補一覧から選択→
     選択したリリースのクレジットを取得→クレジット対象人物ごとに
     「既存アーティストと一致」or「新規/既存credit_person」を判定して
     プレビュー表示→人間が確認→取り込み

app/admin/data/albums/[id]/credits/actions.ts (新規)
  └─ importAlbumCredits: 対象人物ごとにartist.musicbrainz_idと照合し、
     一致すればartist_relationへ、不一致ならcredit_personを検索/作成した上でartist_creditへ書き込む

app/components/RelationGraph.tsx (既存に変更)
  └─ RelationNodeにtype: 'artist' | 'person'を追加。人物ノードの見た目を区別し、
     クリック遷移先を/people/[id]に分岐

app/people/[id]/page.tsx (新規)
  └─ 人物名+役割ごとにグループ化したクレジット一覧(アーティスト名・アルバム名・役割・出典)、読み取り専用

app/artists/[id]/page.tsx (既存に変更)
  └─ RelationGraphへ渡すノード/エッジに、artist_creditから取得した人物ノードも
     マージして含める(アーティスト間関係は既存のartist_relation由来のまま変更不要)

app/admin/data/artists/[id]/edit/page.tsx (既存に変更)
  └─ このアーティストのアルバム一覧を表示し、各アルバムに
     「クレジットを取り込む」リンク(/admin/data/albums/[id]/credits へ)を追加
```

## データフロー

1. 管理者がアーティスト編集ページで、対象アーティストのアルバム一覧から1件選び「クレジットを取り込む」を押す
2. アルバムタイトルでMusicBrainzのリリースを検索し、候補一覧(タイトル・発売日・国)から正しいリリースを選択する
3. 選択したリリースの制作クレジットをMusicBrainzから取得し、主要7役割でフィルタ
4. クレジット対象人物ごとに、MBIDが既存`artist.musicbrainz_id`と一致するかを判定
   - 一致 → 「既存アーティスト『XXX』として登録」とプレビューに明記
   - 不一致(またはDiscogs経由で名前のみの照合) → 新規/既存の`credit_person`候補として表示
5. 管理者が一覧を確認し、取り込む項目を選んで送信
6. 確定した項目のうち、既存アーティスト一致分は`artist_relation`に、それ以外は`credit_person`を検索/作成した上で`artist_credit`(このアルバムのIDも記録)に書き込む
7. アーティスト詳細ページの相関図に反映される(アーティスト同士は既存ロジックのまま、クレジット人物は新規ノードとして追加)

## エラーハンドリング

- MusicBrainzのリリース検索で候補が0件の場合、その旨を表示する
- クレジット取得に失敗した場合、エラーを表示し取り込みボタンは表示しない
- 名前のみでの人物照合(Discogs経由、またはMBIDが無いケース)による同姓同名誤判定のリスクは受容する。人間が確認画面で見て気づける範囲とし、これ以上複雑な名寄せロジックは作らない
- `artist_relation`/`artist_credit`とも、再取込み時は既存のunique制約により重複挿入されない

## テスト方針

自動テストは追加しない(既存の検証スタイルに合わせる)。実装後に`npx tsc --noEmit`と実機確認(King Gnuの実アルバム、Yaffleを含む実データ)を行う。特に「Yaffleが既存アーティストとして正しく`artist_relation`に振り分けられ、Yaffle自身の相関図・アーティストページにも反映される」ケースを重点的に確認する。
