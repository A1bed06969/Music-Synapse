# アーティスト・会場マップ(地図UI) 設計

## 背景

前段のspec([2026-08-11-geo-coordinates-design.md](2026-08-11-geo-coordinates-design.md))でアーティストの出生地/結成地座標(`artist.origin_latitude`/`origin_longitude`)と会場座標(`venue_location`テーブル)の収集機能を実装済み。現在アーティスト21件中13件、会場1件に実座標データが入っている。本specはこのデータを使い、実際の地図(Google My Maps程度の精度の実地理座標ベースの地図)にピンとして表示する機能を設計する。

## ゴール

- アーティストの出生地/結成地と、イベント会場の両方を同じ地図上にピン表示し、色で区別する
- 実際の地理座標に基づく本物の地図(パン・ズーム可能)を使う。既存の`utils/prefectures.ts`のようなデフォルメされたSVG地図とは別物
- アーティストピンをクリックすると、画像・名前・代表アルバム数枚をポップアップ表示し、アーティストページへのリンクを提供する
- 会場ピンをクリックすると、会場名と開催イベント一覧をポップアップ表示し、各イベントページへのリンクを提供する
- 会場名の突き合わせ(`venue_location.venue_name`と`music_event`/`event_edition`/`event_appearance`の`venue`列)を、全角/半角・空白の揺れに対応できるよう正規化する

## 非ゴール

- 座標データ自体の追加収集・拡充(前段のspecで実装済みの管理画面を使って別途進める)
- 会場マッチングの高度な名寄せ(表記揺れの正規化はするが、別名・略称等の意味的な同一判定はしない)
- 地図上でのフィルタリング・検索機能(ジャンル別表示、期間指定等)
- モバイル最適化の作り込み(レスポンシブ対応の範囲内で動作すれば十分)

## アーキテクチャ

```
utils/textNormalize.ts (新規)
  └─ export function normalizeVenueName(value: string): string
     (value.trim().normalize('NFKC') — 全角/半角・前後空白の揺れを吸収)

app/map/LeafletMap.tsx (新規, 'use client')
  └─ ドメイン非依存の汎用地図コンポーネント。
     props: { markers: { id: string; latitude: number; longitude: number;
              color: string; popupHtml: string }[] }
     Leaflet + OpenStreetMapタイルで地図を描画し、markersをL.divIconの
     カラー円形マーカーとして配置。クリックでpopupHtmlをポップアップ表示する。

app/map/MapClientWrapper.tsx (新規, 'use client')
  └─ next/dynamic(() => import('./LeafletMap'), { ssr: false })でLeafletMapを
     読み込む薄いラッパー。このNext.jsバージョンでは`ssr: false`はClient
     Component内でのみ有効なため、Server Componentから直接dynamic importできず
     この薄いラッパーが必要(node_modules/next/dist/docs/01-app/02-guides/
     lazy-loading.mdで確認済み)。

app/map/page.tsx (新規, Server Component)
  └─ artist(origin_latitude/origin_longitudeが非null)+各アーティストの代表
     アルバム(直近3件)を取得
  └─ venue_location全件と、music_event/event_edition/event_appearanceの
     venue列をnormalizeVenueName()で正規化した上で突き合わせ、該当イベント
     一覧を取得
  └─ 上記をLeafletMap用のmarkers配列(アーティストは赤系、会場は青系の色)に
     変換し、MapClientWrapperにpropsとして渡す
```

新規依存: `leaflet`(地図描画本体)。既存の`RelationGraph`コンポーネントがReactラッパーを使わずd3を直接扱っている前例に倣い、`react-leaflet`は使わず`leaflet`を直接refベースで扱う。

## データモデル

新規のテーブル・カラムは無い。既存の`artist.origin_latitude`/`origin_longitude`、`venue_location`、`music_event`/`event_edition`/`event_appearance`の`venue`列をそのまま読む。

## 会場名の正規化

`normalizeVenueName()`を次の2箇所で使う:
- `venue_location.venue_name`を読んだ直後
- `music_event`/`event_edition`/`event_appearance`の`venue`列を読んだ直後

両方を正規化してから文字列比較することで、書き込み時点でのデータ(前段のspec実装時点では正規化していなかった)に関わらず、読み取り時に一貫して揺れを吸収する。既存データへのマイグレーション(書き込み済み値の正規化)は行わない。

## エラーハンドリング

- 座標が無いアーティスト・会場はピンを作らない(既知の制限として受容済み)
- Leafletタイルの読み込み失敗は特別なハンドリングをせず、ブラウザ・Leafletのデフォルト挙動に任せる
- マーカーが0件(座標データが将来的にすべて削除される等)の場合は、地図自体は空の状態で表示する(特別なメッセージは出さない、Leaflet標準のズーム可能な空地図として表示される)

## テスト方針

自動テストは追加しない。実装後に`npx tsc --noEmit`と実機確認を行う:
1. `/map`をブラウザで開き、パン・ズームが正常に動作することを確認
2. アーティストピン(赤系)をクリックし、画像・名前・代表アルバムがポップアップ表示され、アーティスト名クリックで`/artists/[id]`に正しく遷移することを確認
3. 会場ピン(青系)をクリックし、会場名・開催イベント一覧がポップアップ表示され、イベント名クリックで対応するイベントページに正しく遷移することを確認
4. 全角/半角の表記揺れがある会場名(実データにあれば)で、正規化後も正しく突き合わせできていることを確認
