# アーティスト年表 設計

## 背景

年表タペストリー機能(アーティスト年表・ジャンル年表・レーベル年表)の第2弾。レーベル年表(実装済み)は既存データのみで組み立てられたが、アーティスト年表はリリース・ライブ/フェス出演に加えて「タイアップ」(アニメ/ドラマ/CM等での楽曲使用)を含めたいというユーザー要望があり、これは既存テーブルに無い新しい概念のため新規テーブルが必要になる。

## ゴール

- アーティストのリリース(`album`)・単独ライブ(`music_event`)・フェス出演(`event_appearance`)・タイアップ(新規`tie_up`)を時系列1本にまとめ、アーティストページに横スクロールの年表として表示する
- タイアップは管理画面から手動入力できるようにする(MusicBrainz/Wikidataに日本国内向けタイアップ情報がほぼ無いため自動取込は対象外)

## 非ゴール(今回やらないこと)

- ジャンル年表(別spec)
- タイアップの自動取込(手動入力のみ)
- 実日付に比例した横軸配置(均等間隔で並べるのみ。レーベル年表のような縦の年区切りグルーピングも今回はしない — 横スクロールの並び順のみで時系列を表現する)
- タイアップの脱退/終了表現(アーティストのレーベル所属のような期間概念は無く、1件1年のみ)

## データモデル

新規テーブル`tie_up`(track単位):

```sql
create table tie_up (
  id text primary key default generate_ms_id('TIE'),
  track_id text not null references track(id),
  category text not null check (category in ('anime', 'drama', 'movie', 'cm', 'game', 'other')),
  work_title text not null,   -- 作品名(例: 鬼滅の刃)
  year integer,               -- タイアップされた年(曲のリリース年と異なりうる)
  note text,                  -- 補足(OP/ED/挿入歌、企業名など自由記述)
  created_at timestamptz not null default now()
);

alter table tie_up enable row level security;
create policy "tie_up is publicly readable" on tie_up for select using (true);
```

`track`テーブルは既に`artist_id`を持つため、`tie_up`から`track`経由でアーティストを特定できる(`album`を介さず直接絞り込める)。書き込みは他の管理画面テーブルと同じく`service_role`のみ(RLSのINSERT/UPDATE/DELETEポリシーは追加しない=デフォルトで拒否、admin操作は`createAdminClient`のservice_roleキー経由)。

## アーキテクチャ

```
supabase/migrations/20260819_create_tie_up.sql (新規、上記DDL)

app/admin/data/tieups/actions.ts (新規)
  └─ createTieUp(formData): track_id/category/work_title/year/noteを受けてinsertする
     (既存のcreateLabel等と同じ'use server'パターン)

app/admin/data/tieups/page.tsx (新規)
  └─ SearchableSelect(searchAction=searchTracks、app/admin/data/actions.tsに既存)で
     トラックを選び、category(<select>固定5択+その他)・work_title・year・noteを入力する
     フォーム。登録済み一覧も下に表示(トラック名 — 作品名(種別・年))

utils/artistTimeline.ts (新規、utils/labelTimeline.tsと同じ形の純粋関数)
  ├─ export type ArtistTimelineEntry = {
  │      date: string  // 'YYYY-MM-DD'
  │      kind: 'release' | 'live' | 'festival' | 'tieup'
  │      title: string
  │      subtitle: string | null   // リリース元アルバム名、会場名、フェス名など
  │      href: string | null
  │      imageUrl: string | null   // アルバムジャケット等、あれば
  │    }
  ├─ export type ArtistTimelineInput = {
  │      releases: { albumId: string; title: string; releaseDate: string | null; jacketUrl: string | null }[]
  │      lives: { id: string; name: string; eventDate: string | null; venue: string | null }[]
  │      festivals: { appearanceId: number; eventName: string; startTime: string | null; venue: string | null; editionId: string }[]
  │      tieUps: { id: string; trackTitle: string; category: string; workTitle: string; year: number | null; albumId: string | null }[]
  │    }
  └─ export function buildArtistTimeline(input: ArtistTimelineInput): ArtistTimelineEntry[]
       (日付が無い行は除外。releasesはrelease_date、livesはevent_date、festivalsは
        start_time、tieUpsはyearから`${year}-01-01`を使う。日付昇順ソート)

app/artists/[id]/ArtistTimeline.tsx (新規、サーバーコンポーネント)
  └─ app/artists/[id]/page.tsxが既に取得済みのalbums/musicEvents/eventAppearances
     (既存クエリ)+ 新規tieUpsクエリをフラット化してbuildArtistTimelineへ渡し、
     横スクロールのカード列として描画する(既存のDiscographyセクションと同じ
     `mt-4 flex gap-4 overflow-x-auto pb-2`パターン、カードはアイコン+日付+タイトル)

app/artists/[id]/page.tsx (変更)
  └─ tie_upの取得クエリを追加(track経由でartist_idに紐づくものをJOIN)。
     Discographyセクションの後に「年表」セクションを追加(既存セクションは維持)
```

## UI

横スクロールのカード列。既存のDiscographyカード(ジャケット画像+タイトル+日付)と統一感を持たせつつ、種別ごとに小さいアイコンを添える(💿リリース/🎤ライブ/🎪フェス/📺タイアップ)。均等間隔で時系列順に並べるのみで、実日付に比例した配置や年ラベルのグルーピングはしない(レーベル年表と異なる方針、ユーザー確認済み)。

## エラーハンドリング

- タイアップのyear未入力時は年表に出さない(日付不明のため)
- 既存のDiscography/Live Info/Festival Appearancesセクションは変更しない

## テスト方針

- `buildArtistTimeline`: 単体テストでマージ・ソートロジックを検証(4種類混在の日付昇順、日付nullの行の除外)
- `createTieUp`: 型チェックのみ(既存の同種のサーバーアクションと同じ、統合テストは無し)
