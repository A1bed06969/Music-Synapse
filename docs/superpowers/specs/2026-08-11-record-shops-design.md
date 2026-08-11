# レコードショップ情報収集 設計

## 背景

ロードマップ(#7「国内外CD/レコードショップ店舗情報収集」)に着手する。将来的にはOpenStreetMap Overpass API(`shop=music`)による世界規模の一括収集と、日本のチェーン店の公式店舗検索ページからの手動バックフィルの両方を想定しているが、これらは独立した仕組みであるため、本specはまず手動登録+地図表示のみを対象とする。Overpass一括収集は別specで後日設計する。

先行して実装済みの`/map`ページ(アーティスト出身地/結成地=赤ピン、イベント会場=青ピン)に、レコードショップを3種類目のピン(緑)として追加する。

## ゴール

- 管理画面からレコードショップを1件ずつ手動登録できる(店名・住所・公式サイトURL(任意)・営業時間(任意)を入力 → 住所をジオコーディングして座標を確定)
- `/map`ページにレコードショップをピンとして表示し、クリックすると店名・住所・営業時間・公式サイトリンクをポップアップ表示する
- 登録済み店舗の一覧を管理画面で確認できる(重複登録防止の目安)

## 非ゴール

- Overpass APIによる世界規模の一括収集(別specで後日設計)
- 営業時間の構造化(曜日別パース等) — 自由入力テキストとして保存・表示するのみ
- 店舗の編集・削除UI(既存のvenue_location登録フローにも無い。将来必要になれば別途)
- レコードショップ専用の一覧・詳細ページ(地図上での表示のみ)

## アーキテクチャ

```
app/admin/data/shops/page.tsx (新規, Server Component)
  └─ 登録フォーム(店名・住所・URL・営業時間)
  └─ 既存登録済み店舗一覧(record_shop全件、参考表示)
  └─ ?address=... が付いている場合、ShopCandidatesで候補表示

app/admin/data/shops/actions.ts (新規)
  └─ export async function importRecordShop(formData: FormData)
     name/address/url/hours/latitude/longitudeを受け取り、record_shopにinsert

app/admin/data/shops/SubmitButton.tsx (新規, 'use client')
  └─ 既存venues/SubmitButton.tsxと同様のpending状態ボタン

app/map/page.tsx (既存, 変更)
  └─ record_shop全件を取得し、shopMarkers: MapMarker[]に変換(色は緑系 #5ad66f)
  └─ markers = [...artistMarkers, ...venueMarkers, ...shopMarkers]
  └─ 凡例文言に「レコードショップ(緑)」を追記
```

登録フローは既存の`app/admin/data/venues/`と同じ形(住所テキストを`utils/nominatim.ts`の`geocodeVenue()`でジオコーディングし、候補から選んで確定)を踏襲する。`geocodeVenue()`はvenue名専用ではなく汎用のNominatim検索ラッパーなので、そのまま流用する(改名等のリファクタリングはしない)。

venuesページとの違いは、venuesは既存の`music_event`/`event_edition`/`event_appearance`のvenue列から「未解決の会場名」を自動抽出するのに対し、shopsは参照元となる既存テーブルが無いため、店名・住所・URL・営業時間をその場で自由入力する点。

## データモデル

新規テーブル`record_shop`:

```sql
create table record_shop (
  id          text primary key default generate_ms_id('SHP'),
  name        text not null,
  address     text not null,
  url         text,
  hours       text,
  latitude    numeric not null,
  longitude   numeric not null,
  source      text not null default 'manual',
  created_at  timestamptz not null default now()
);
```

`source`列は将来Overpass一括収集を追加する際に`'manual'`と`'overpass'`等を区別するために設ける(`venue_location`の`source`列と同じ位置づけ)。

## エラーハンドリング

- Nominatimでの検索結果が0件、またはAPI呼び出し失敗時は、既存venuesページと同様にエラーメッセージを表示する
- URL・営業時間は任意項目のため、未入力ならポップアップ上でその行を省略する

## テスト方針

自動テストは追加しない。実装後に`npx tsc --noEmit`と実機確認を行う:

1. `/admin/data/shops`から「バナナレコード 大阪梅田店」(住所: 大阪市北区芝田2丁目1-3 梅仙堂ビル3F)を登録し、正しい候補が出ることを確認
2. `/map`を開き、緑ピンが正しい位置に表示されることを確認
3. ピンをクリックし、店名・住所・営業時間・公式サイトリンクがポップアップに表示されることを確認(URL/営業時間未入力の場合はその行が出ないことも確認)
