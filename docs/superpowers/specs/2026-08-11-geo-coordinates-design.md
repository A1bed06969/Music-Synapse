# 座標データ収集(出生地・結成地・会場) 設計

## 背景

アーティストの出生地・結成地、フェス/イベントの会場の座標データを収集し、世界地図にプロットしたい(ロードマップ項目④)。これは「実データ収集」と「実地図表示UI」の2つの柱を持つ機能であり、地図UIは実データが無いと動作確認できないため、まず本specでデータ収集のみを完成させ、地図UI(ピン表示・クリック時のポップアップ等)は後続の別specで扱う。

以前のMusicBrainz連携で、既に21件のアーティストが`artist_external_link`テーブルに`link_type = 'wikidata'`のリンク(Wikidata QID)を保持していることを実データで確認済み(例: King Gnu → `https://www.wikidata.org/wiki/Q48760263`)。これにより多くのアーティストは名前でのあいまい検索を経由せず、既知のQIDから直接構造化データを取得できる。

## ゴール

- Wikidata IDが既知のアーティストについて、Wikidataの出生地(P19、個人向け)/結成地(P740、グループ向け)から座標を解決し、一括自動で`artist`に反映する
- Wikidata IDが未知のアーティストについて、名前でWikidataを検索し、人間が候補を確認した上で座標を取り込む(既存のMusicBrainz検索と同じUXパターン)
- イベント/出演の会場(`venue`)についてNominatimで座標をジオコーディングし、人間が確認した上で新設の`venue_location`テーブルに登録する

## 非ゴール

- 地図UI本体(ピン表示・クリック時のポップアップ等)。これは実データが揃った後の別specで扱う
- Wikidataの出生地/結成地データが元々存在しないケースへの代替収集(例: 手動入力UI、他ソースでの補完)。データが無ければ「座標データなし」として受容する
- 同名だが異なる実在会場の高精度な名寄せ。会場名の完全一致でのみ`venue_location`と突き合わせる
- 定期実行の自動収集。既存パターンを踏襲し、管理画面からの手動トリガー(一括ボタン、または個別確認フロー)

## データモデル

```sql
-- artistテーブルに座標列を追加(1アーティスト=1点。個人なら出生地、グループなら結成地)
alter table artist add column origin_latitude numeric;
alter table artist add column origin_longitude numeric;

-- 会場座標は新規テーブルで一元管理。既存のmusic_event/event_edition/event_appearanceの
-- venue列(自由入力テキスト)は変更しない。地図構築時にvenue文字列でこのテーブルと
-- 突き合わせる。
create table venue_location (
  id text primary key default generate_ms_id('VLC'),
  venue_name text not null,
  latitude numeric not null,
  longitude numeric not null,
  source text not null, -- 'nominatim'
  created_at timestamptz not null default now()
);
create unique index venue_location_name_key on venue_location (venue_name);
```

## アーキテクチャ

```
migration:
  - artist.origin_latitude / origin_longitude 列追加
  - venue_location テーブル新規作成(RLS: public read、書き込みはservice_roleのみ、既存踏襲)

utils/wikidata.ts (新規)
  └─ searchWikidataEntity(name: string): Promise<{ qid: string; label: string; description: string | null }[]>
     (Wikidata検索API、名前が未知の場合の候補検索)
  └─ fetchOriginCoordinates(qid: string): Promise<{ latitude: number; longitude: number; placeLabel: string } | null>
     (SPARQLでP19またはP740→対象entityのP625を解決。無ければnull)

utils/nominatim.ts (新規)
  └─ geocodeVenue(venueName: string): Promise<{ latitude: number; longitude: number; displayName: string }[]>
     (Nominatim検索API、候補を複数返す)

app/admin/data/artists/geo/page.tsx (新規、一括自動更新)
  └─ Wikidata IDを持つ全アーティストに対しfetchOriginCoordinatesを実行し、
     取得できたものを一覧表示(確認不要、実行結果のサマリのみ)

app/admin/data/artists/geo/actions.ts (新規)
  └─ bulkUpdateOriginFromWikidata(): 対象アーティスト全件をループしorigin_latitude/longitudeを更新

app/admin/data/artists/[id]/edit/page.tsx (既存に変更)
  └─ Wikidata IDが無いアーティスト向けに「Wikidataで座標を検索」リンクを追加

app/admin/data/artists/[id]/geo-search/page.tsx (新規)
  └─ 名前でWikidataを検索→候補確認→座標取り込み(既存のMusicBrainz検索と同じパターン)

app/admin/data/artists/[id]/geo-search/actions.ts (新規)
  └─ importOriginCoordinates: 選択されたQIDから座標を取得しartist.origin_latitude/longitudeへ保存

app/admin/data/venues/page.tsx (新規)
  └─ music_event/event_edition/event_appearanceのvenueのうち、venue_locationに
     未登録のものを一覧表示→Nominatimで検索→候補確認(簡易地図プレビュー)→取り込み

app/admin/data/venues/actions.ts (新規)
  └─ importVenueLocation: 選択された候補をvenue_locationへ保存
```

## データフロー

1. **アーティスト一括**: 管理者が「座標を一括更新」を実行 → Wikidata IDを持つ全アーティストについてP19/P740→座標を解決 → 取得できたものは確認無しでそのまま保存、取得できなかったものは結果一覧に「座標データなし」として表示
2. **アーティスト個別**: 管理者がWikidata未リンクのアーティストの編集ページから「Wikidataで座標を検索」→名前で検索→候補確認→取り込み
3. **会場**: 管理者が会場一覧ページで未登録のvenueを選択→Nominatimで検索→候補確認(地図プレビュー付き)→取り込み

## エラーハンドリング

- Wikidata/Nominatimへの通信失敗は個別にエラー表示し、一括処理中の他のアーティスト/会場の処理は継続する
- Wikidata側にP19/P740が無いアーティストは「座標データなし」として一括結果にまとめて表示し、エラー扱いにしない
- 名前検索・Nominatim検索で候補が0件の場合はその旨を表示し、取り込みボタンは表示しない
- 同名だが異なる実在会場の誤登録リスクは受容し、これ以上の名寄せロジックは作らない

## テスト方針

自動テストは追加しない。実装後に`npx tsc --noEmit`と実機確認を行う:
1. Wikidata ID既知の一括自動更新を実行し、Ado(個人、P19出生地あり)の座標が正しく反映されることを確認
2. King Gnu(グループ、Wikidata側にP740結成地データが無い)が「座標データなし」として正しく報告されることを確認
3. Wikidata未リンクのアーティスト1件で、名前検索→候補確認→取り込みが正しく動作することを確認
4. 実在の会場1件でNominatimジオコーディング→候補確認→`venue_location`への取り込みが正しく動作することを確認
