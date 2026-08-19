# アーティスト出身地マップ ドリルダウン表示 設計

## 背景・目的

`/map`のアーティストタブは現在、各アーティストの`origin_latitude`/`origin_longitude`(Wikidata由来またはNominatim手動ジオコーディングで取得した1点の緯度経度)を色付きドット(`L.divIcon`)としてLeaflet地図上にプロットしている。クリックすると画像付きポップアップが出る。

これを「点のプロット」ではなく、アーティストが紐づく行政区画(市区町村・州/地域・国)を薄く塗りつぶす表示に変更したい。米英のようにアーティスト数が多い国では、国単位の塗りつぶしだけでは粒度が粗すぎるため、可能な国では州・地域レベルまで塗り分ける。

## 現状(調査結果のサマリ)

- `origin_latitude`/`origin_longitude`は`artist`テーブルの素のカラム。市区町村コードのような構造化IDは存在しない。`origin_prefecture`/`hometown_city`は自由入力の文字列で、正規化されたコードではない。
- `hometown_country`も自由入力(日本語ローカライズされた国名文字列、例:「アメリカ合衆国」「イギリス」)。`scripts/backfill-artist-hometown-country.ts`がNominatim逆ジオコーディングで一度埋めたもの。
- 行政区画のポリゴン(GeoJSON境界)データはリポジトリ内に一切ない。`utils/japan-map.ts`は都道府県レベルのSVGパスデータ(実座標系ではない、`app/components/PrefectureMap.tsx`専用)のみで、今回の用途には流用できない。
- マップは素のLeaflet API(`leaflet`パッケージ、react-leafletではない)。`app/map/LeafletMap.tsx`が`L.map`/`L.marker`/`L.featureGroup`を直接操作している。
- `utils/continents.ts`に自由入力の国名文字列→大陸(日本語ラベル)の簡易マップが既にあるが、`/events`ページ専用で、カバレッジに漏れがある(例:今回確認した「アメリカ合衆国」という表記は未収録)。今回の新機能では、この既存マップには依存しない、より頑健な方式を採る(下記データソース参照)。

## ゴール

- `/map`のアーティストタブに、大陸→国→(州/地域 または 市区町村)のドリルダウン型塗りつぶし表示を追加する。
- 日本国内のアーティストは市区町村単位まで、日本以外は可能な国ではISO 3166-2の州・地域単位まで塗り分ける。
- アーティスト一覧から特定のアーティストを選ぶと、そのアーティストの市区町村/州地域までズームする。
- すべて無料のデータソース・APIのみで実現し、追加費用は発生させない。

## 非ゴール

- venue(会場)・shop(レコードショップ)タブは対象外。現状の点マーカーのまま。
- 市区町村より細かい粒度(町丁目等)は扱わない。
- 州・地域データが取得できない国(Natural Earthに収録が無い、またはNominatimがISO3166-2-lvl4を返さない国)を、追加のデータソースを探してまで個別対応することはしない。国ブロック表示にフォールバックする。
- 日本に「都道府県」のドリルダウン段階は追加しない(国→市区町村に直接遷移。米英等の「国→州/地域」とは階層が1段違うが、今回はこの非対称を許容する)。

## データソース(すべて無料・費用ゼロを確認済み)

| 用途 | ソース | 備考 |
|---|---|---|
| 座標→日本の市区町村コード(5桁JISコード) | 国土地理院(GSI) 逆ジオコーディングAPI `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lon=..&lat=..` | 無料・APIキー不要。レスポンス例: `{"results":{"muniCd":"13101","lv01Nm":"..."}}` |
| 座標→国コード・州/地域コード(ISO 3166-2) | Nominatim逆ジオコーディング(既存の`scripts/backfill-artist-hometown-country.ts`と同じAPI) | `address.country_code`(例:`us`)、`address.ISO3166-2-lvl4`(例:`US-CA`、`GB-ENG`)を利用。米は州、英はイングランド/スコットランド/ウェールズ/北アイルランドの4地域相当。利用ポリシー上1リクエスト/秒程度に制限が必要(既存スクリプトと同様の配慮を踏襲)。 |
| 日本の市区町村ポリゴン | GitHub `niiyz/JapanCityGeoJson`(国土数値情報 行政区域データ由来、2020年版) | `geojson/{都道府県コード2桁}/{5桁muniCd}.json`で1市区町村ずつ個別ファイル取得可能(1ファイル約10〜100KB)。実際に必要な市区町村だけを都度取得してDBにキャッシュする(全1,700件を先読みしない)。 |
| 州・地域ポリゴン(世界、Admin-1) | GitHub `martynafford/natural-earth-geojson`の`50m/cultural/ne_50m_admin_1_states_provinces.json`(Natural Earth、パブリックドメイン) | 世界全体で約1.6MB。`iso_3166_2`プロパティでNominatimの`ISO3166-2-lvl4`と直接突合できる。取得は初回のみ(サーバ側で1回フェッチし、必要な地域だけ抽出してDBにキャッシュ)。 |
| 国ポリゴン(世界、Admin-0) | 同リポジトリの`110m/cultural/ne_110m_admin_0_countries.json`(Natural Earth、パブリックドメイン) | 世界全体で約725KB。低解像度で「大陸ズーム時に国を塗り分ける」用途に十分。`ISO_A2`(2文字国コード)と`CONTINENT`(大陸名、英語)プロパティを持つ。この`CONTINENT`をそのまま使うことで、既存の`utils/continents.ts`(自由入力国名ベースで漏れがある)には依存しない、コード起点の頑健な大陸判定ができる。 |

いずれもAPIキー・利用登録・課金が不要な公開データ/APIであることを確認済み。ライセンス表記(国土数値情報・Natural Earthのクレジット)は既存の`utils/japan-map.ts`冒頭コメントの慣習に倣い、新規ファイルにも出典コメントを残す。

## データモデル

### `artist`テーブルへのカラム追加

```sql
ALTER TABLE artist
  ADD COLUMN origin_country_code text,   -- ISO 3166-1 alpha-2 (小文字, 例: 'jp', 'us', 'gb')
  ADD COLUMN origin_region_code text,    -- ISO 3166-2 (例: 'US-CA', 'GB-ENG')。日本は常にNULL
  ADD COLUMN origin_muni_code text;      -- 5桁JISコード(例: '13101')。日本以外は常にNULL
```

- 既存の`origin_latitude`/`origin_longitude`/`origin_prefecture`/`hometown_city`/`hometown_country`はそのまま残す(表示用・既存機能用に引き続き使用)。今回追加する3カラムは、地図の塗りつぶし判定専用の「解決済みコード」というレイヤーとして独立させる。

### 新テーブル `geo_boundary`(市区町村・州地域のポリゴンキャッシュ)

```sql
CREATE TABLE geo_boundary (
  id text PRIMARY KEY DEFAULT generate_ms_id('GEB'),
  level text NOT NULL CHECK (level IN ('municipality', 'region')),
  code text NOT NULL,              -- muniCd または ISO3166-2コード
  name text,                       -- 表示名(取得元データのまま。市区町村は日本語、州地域は英語)
  geometry jsonb NOT NULL,         -- GeoJSON Geometry(Polygon/MultiPolygon)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (level, code)
);
```

- 国レベルの世界地図(`ne_110m_admin_0_countries.json`)は725KBと小さいため、DBキャッシュはせず、静的アセットとしてリポジトリに同梱し、クライアントから直接フェッチする(`public/geo/world-countries.json`のような配置を想定)。
- `municipality`/`region`レベルは、実際にアーティストが割り当てられた分だけ初回参照時に取得してこのテーブルにキャッシュする(全世界・全市区町村を先読みしない)。

## 解決ロジック(バックフィル・新規ジオコーディング時)

`origin_latitude`/`origin_longitude`が確定しているアーティストに対して、既存のジオコーディングフロー(Wikidata取込 / 管理画面での手動ジオコーディング)の**後続処理**として1回だけ実行する(既存の`tmp-backfill-artist-labels.ts`のような、既存カラムが未設定のアーティストのみを対象にした一括バックフィルスクリプトを今回も新規作成する想定)。

1. Nominatim逆ジオコーディングを1回呼び、`address.country_code`と`address.ISO3166-2-lvl4`を取得する。
2. `origin_country_code`に`country_code`を保存する。
3. `country_code === 'jp'`の場合:
   - GSI逆ジオコーディングAPIを呼び、`muniCd`を`origin_muni_code`に保存する(`origin_region_code`はNULLのまま)。
   - `geo_boundary`に該当`muniCd`のレコードが無ければ、`niiyz/JapanCityGeoJson`から個別ファイルを取得してキャッシュする。
4. `country_code !== 'jp'`の場合:
   - `ISO3166-2-lvl4`が取得できていれば`origin_region_code`に保存する。
   - `geo_boundary`に該当コードのレコードが無ければ、Natural Earthの`admin_1_states_provinces`データ(1回フェッチ・メモリ上でパース)から該当featureを抽出してキャッシュする。取得できなければ`origin_region_code`はNULLのまま(=国ブロック表示にフォールバック)。

Nominatim・GSIともにレート制限に配慮し、既存の`tmp-backfill-artist-labels.ts`と同様に直列・スリープ入りで処理する。件数は少ない(現状座標登録済みは数十〜百件規模)ため、時間はかかっても問題ない想定。

## UI状態遷移(ドリルダウン)

アーティストタブのマップ状態を4段階で管理する(`TabbedMapView.tsx`にstateを持たせる想定):

1. **World(初期表示)**: 個々の国は塗り分けず、大陸ごとの合計アーティスト数を、大陸の目安位置(6大陸ぶんの固定座標をハードコードしたラベル/マーカー)に表示。クリックでその大陸へズーム。
2. **Continent**: その大陸に属する国(`ISO_A2`の`CONTINENT`一致で判定)のうち、アーティストが1人以上いる国を`world-countries.json`のポリゴンで一律の薄さで塗りつぶす。クリック時、その国に`geo_boundary`(region/municipality)データがあればState 3へ自動遷移し、無ければその場でポップアップ(その国のアーティスト一覧)を表示する。
3. **Region/Municipality**: 選択した国の中の州地域(日本以外)または市区町村(日本)を、`geo_boundary`から取得したポリゴンで一律の薄さで塗りつぶす。クリックでポップアップ(そのregion/municipalityのアーティスト一覧、画像付き — 現行のポップアップ書式を流用)。
4. **アーティスト一覧からの選択**: 現在のドリルダウン位置に関わらず、そのアーティストの市区町村(日本)または州地域(日本以外、データが無ければ国)まで直接ズームし、対応するポリゴンをハイライトする。

すべての階層で「戻る」操作(大陸一覧に戻る等)を用意する。

## レンダリング方式

- Leafletの`L.geoJSON(featureData, { style, onEachFeature })`を使い、既存の`L.marker`ベースの描画と並べて新しいレイヤーとして追加する(`LeafletMap.tsx`に新しい描画モードを追加する形。venue/shopタブは既存の点マーカー実装のまま分岐)。
- 座標未登録、またはNominatim/GSIで国・地域が解決できなかったアーティストは、合意済みの通り**従来通り点マーカーで表示**(該当国/大陸の中に、そのアーティストの薄いポリゴンが無い場合の穴埋めとして機能する)。
- ポップアップの中身(画像・アーティスト名等)は現状から変更しない。

## テスト方針

- 座標→`country_code`/`ISO3166-2-lvl4`/`muniCd`の解決ロジックは外部API呼び出しを含むため、既存の`utils/wikidata.ts`や`utils/musicbrainz.ts`同様、ロジック部分(レスポンスのパース、コード→保存カラムの振り分け)を純粋関数として切り出し、モックレスポンスに対するユニットテストを書く。
- `geo_boundary`キャッシュのget-or-fetchロジックも同様に純粋関数化してユニットテストする。
- ドリルダウンの状態遷移(World→Continent→Region→戻る)はユニットテスト可能な状態マシンとして`utils/`に切り出す(Reactコンポーネントのstateに直接書かず、テスト容易性を優先する)。
- 実データでの動作確認は、既存セッションで確立した手順(ローカルdev起動 + Basic Authでcurl、本番デプロイ後に同様に確認)を踏襲する。

## 実装への申し送り事項(未決定・実装時に判断する点)

- 大陸の固定ラベル位置(6大陸ぶんの緯度経度)は実装時に妥当な値を決める。
- `geo_boundary`テーブルと既存の`venue_location`テーブルとの役割分担(将来的に統合するかどうか)は今回はスコープ外とし、独立したテーブルとして新設する。
- Natural Earthデータの`iso_3166_2`プロパティが一部の国(データソース内で言及あり: フランス・日本・フィンランドなど)で欠落しているケースがある。日本は今回そもそもこのデータソースを使わないため影響なし。他国での欠落は「国ブロックへのフォールバック」として自然に吸収される。
