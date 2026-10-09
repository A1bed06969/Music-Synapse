// 共通の表編集(DataGrid)で扱うテーブルの定義。どのテーブル・列を書き換えられるかは
// ここ(サーバー側)だけで決め、クライアントからはキー(tableKey)しか受け取らない。
import { createAdminClient } from '@/utils/Supabase/admin'
import { PREFECTURE_COORDS } from '@/utils/prefectures'
import { ALBUM_TYPE_LABEL_JA, ALBUM_TYPE_ORDER } from '@/utils/albumType'
import { ARTIST_STREAMING_STATUS_LABEL, ARTIST_TYPE_LABEL, STREAMING_STATUS_LABEL } from '@/utils/format'

export type TargetKind = 'track' | 'album' | 'artist'
export type GridTarget = { kind: TargetKind; id: string; label: string }
export type CellValue = string | number | boolean | null
export type SelectOption = { value: string; label: string }

export type ColumnDef =
  | { key: string; label: string; type: 'text' | 'number' | 'date' | 'checkbox'; width?: string }
  | {
      key: string
      label: string
      type: 'select'
      options?: SelectOption[]
      /** 選択肢をDB等から読み込む場合の種類(サーバー側でoptionsに展開してからクライアントへ渡す) */
      optionsFrom?: 'prefectures' | 'radioStations'
      width?: string
    }
  | { key: 'target'; label: string; type: 'target'; kinds: TargetKind[] }
  /** 編集しない列。保存済みの行から、中身の表など関連ページへ飛ぶリンクを出す(hrefの{id}を行IDに置き換え) */
  | { key: string; label: string; type: 'link'; href: string; text: string; width?: string }

export type GridRow = {
  key: string
  id?: string
  values: Record<string, CellValue>
  target: GridTarget | null
  /** 貼り付けで照合できなかった元の文字列 */
  unresolved?: string
}

// supabase-jsのクエリビルダは型が深く、条件を足すだけの関数に正確な型を付けると扱いにくいため、
// 絞り込みの関数は「.is()/.or()等を足して返す」形に限定してanyで受け渡す
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any

export type TableConfig = {
  table: string
  /** 表を絞り込む親のID列(このランキング、このディスクガイド等)。nullならテーブル全体 */
  scopeColumn: string | null
  columns: ColumnDef[]
  required: string[]
  orderBy: { column: string; ascending: boolean }[]
  /** 表から行を追加できるか(既定true)。マスターデータはApple Music等からの登録に限る */
  allowInsert?: boolean
  /** 表から行を削除できるか(既定true)。削除が他のデータに連鎖するテーブルはfalse */
  allowDelete?: boolean
  /** 件数が多いテーブルは検索で絞り、上位limit件だけを表示する */
  search?: { columns: string[]; limit: number; placeholder: string }
  /** よく使う絞り込み(「読みなし」等)。サーバー側だけで使う */
  presets?: { key: string; label: string; apply: (q: Query) => Query }[]
  /** 表の上に出す注意書き */
  note?: string
}

export const TARGET_COLUMNS: Record<TargetKind, string> = { track: 'track_id', album: 'album_id', artist: 'artist_id' }

const options = (labels: Record<string, string>): SelectOption[] =>
  Object.entries(labels).map(([value, label]) => ({ value, label }))

const PERIOD_OPTIONS: SelectOption[] = [
  { value: 'monthly', label: '月間' },
  { value: 'weekly', label: '週間' },
]

export const GRID_TABLES = {
  ranking: {
    table: 'ranking_entry',
    scopeColumn: 'ranking_id',
    columns: [
      { key: 'rank', label: '順位', type: 'number', width: 'w-20' },
      { key: 'period_date', label: '対象日', type: 'date', width: 'w-36' },
      { key: 'target', label: '曲・アルバム・アーティスト', type: 'target', kinds: ['album', 'track', 'artist'] },
      { key: 'metric_label', label: '指標名', type: 'text', width: 'w-32' },
      { key: 'metric_value', label: '指標値', type: 'number', width: 'w-24' },
    ],
    required: ['period_date', 'target'],
    orderBy: [
      { column: 'period_date', ascending: false },
      { column: 'rank', ascending: true },
    ],
  },
  discguide: {
    table: 'disc_guide_selection',
    scopeColumn: 'disc_guide_id',
    columns: [
      { key: 'target', label: 'アルバム', type: 'target', kinds: ['album'] },
      { key: 'note', label: 'メモ', type: 'text', width: 'w-64' },
    ],
    required: ['target'],
    orderBy: [{ column: 'created_at', ascending: true }],
  },
  festival: {
    table: 'event_appearance',
    scopeColumn: 'event_edition_id',
    columns: [
      { key: 'target', label: 'アーティスト', type: 'target', kinds: ['artist'] },
      { key: 'display_name', label: '表示名(任意)', type: 'text', width: 'w-48' },
      { key: 'stage', label: 'ステージ', type: 'text', width: 'w-40' },
      { key: 'venue', label: '会場', type: 'text', width: 'w-40' },
      { key: 'is_headliner', label: 'ヘッドライナー', type: 'checkbox', width: 'w-28' },
    ],
    required: ['target'],
    orderBy: [{ column: 'id', ascending: true }],
  },
  festivalDates: {
    table: 'event_edition_date',
    scopeColumn: 'event_edition_id',
    columns: [
      { key: 'date', label: '日付', type: 'date', width: 'w-40' },
      { key: 'venue', label: '会場', type: 'text' },
      { key: 'region', label: '地域', type: 'text', width: 'w-48' },
    ],
    required: ['date', 'venue'],
    orderBy: [{ column: 'date', ascending: true }],
  },
  award: {
    table: 'award_entry',
    scopeColumn: 'award_id',
    columns: [
      { key: 'year', label: '年', type: 'number', width: 'w-20' },
      { key: 'category', label: '部門', type: 'text', width: 'w-48' },
      {
        key: 'result',
        label: '結果',
        type: 'select',
        options: [
          { value: 'winner', label: '受賞' },
          { value: 'nominee', label: 'ノミネート' },
        ],
        width: 'w-32',
      },
      { key: 'target', label: '曲・アルバム・アーティスト', type: 'target', kinds: ['album', 'track', 'artist'] },
    ],
    required: ['year', 'target'],
    orderBy: [
      { column: 'year', ascending: false },
      { column: 'category', ascending: true },
    ],
  },
  station: {
    table: 'media',
    scopeColumn: null,
    columns: [
      { key: 'name', label: '局名', type: 'text', width: 'w-48' },
      {
        key: 'media_type',
        label: '種別',
        type: 'select',
        options: [
          { value: 'radio', label: 'ラジオ' },
          { value: 'tv', label: 'テレビ' },
          { value: 'magazine', label: '雑誌' },
          { value: 'web', label: 'Web' },
        ],
        width: 'w-28',
      },
      { key: 'prefecture', label: '都道府県', type: 'select', optionsFrom: 'prefectures', width: 'w-32' },
      { key: 'area', label: 'エリア', type: 'text', width: 'w-28' },
      { key: 'power_play_url', label: 'パワープレイのURL', type: 'text' },
      { key: 'url', label: '公式サイト', type: 'text' },
      { key: 'logo_url', label: 'ロゴ画像URL', type: 'text' },
    ],
    required: ['name', 'media_type'],
    orderBy: [{ column: 'name', ascending: true }],
    allowDelete: false,
    note: '局名はパワープレイの自動収集・HRPPシートの局名と照合に使われます。変えると一致しなくなるので注意してください。局の削除・統合はメディア&オンエア画面から行います。',
  },
  program: {
    table: 'media_program',
    scopeColumn: null,
    columns: [
      { key: 'media_id', label: '局', type: 'select', optionsFrom: 'radioStations', width: 'w-56' },
      { key: 'program_name', label: '番組名', type: 'text' },
      { key: 'period_type', label: '周期', type: 'select', options: PERIOD_OPTIONS, width: 'w-28' },
    ],
    required: ['media_id', 'program_name', 'period_type'],
    orderBy: [{ column: 'program_name', ascending: true }],
    allowDelete: false,
    note: '番組を削除するとオンエア実績も一緒に消えるため、この表からは削除できません。表記ゆれの統合は番組名を揃えたうえでご相談ください。',
  },
  genre: {
    table: 'genre',
    scopeColumn: null,
    columns: [
      { key: 'name', label: 'ジャンル名', type: 'text', width: 'w-48' },
      { key: 'description', label: '説明', type: 'text' },
      { key: 'origin_year', label: '誕生年', type: 'number', width: 'w-24' },
      { key: 'origin_year_label', label: '年代の表記', type: 'text', width: 'w-32' },
      { key: 'origin_country', label: '発祥国', type: 'text', width: 'w-28' },
      { key: 'origin_city', label: '発祥都市', type: 'text', width: 'w-32' },
      { key: 'wikipedia_url', label: 'Wikipedia', type: 'text', width: 'w-56' },
    ],
    required: ['name'],
    orderBy: [{ column: 'name', ascending: true }],
    allowDelete: false,
    search: { columns: ['name', 'description'], limit: 300, placeholder: 'ジャンル名・説明で検索' },
    presets: [
      { key: 'no-description', label: '説明なし', apply: (q) => q.is('description', null) },
      { key: 'no-origin', label: '誕生年なし', apply: (q) => q.is('origin_year', null) },
    ],
  },
  label: {
    table: 'label',
    scopeColumn: null,
    columns: [
      { key: 'name', label: 'レーベル名', type: 'text', width: 'w-64' },
      { key: 'name_kana', label: '読み', type: 'text', width: 'w-48' },
      { key: 'founded_year', label: '設立年', type: 'number', width: 'w-24' },
      { key: 'description', label: '説明', type: 'text' },
    ],
    required: ['name'],
    orderBy: [{ column: 'name', ascending: true }],
    allowDelete: false,
    search: { columns: ['name', 'name_kana'], limit: 300, placeholder: 'レーベル名・読みで検索' },
    presets: [{ key: 'no-kana', label: '読みなし', apply: (q) => q.is('name_kana', null) }],
  },
  livehouse: {
    table: 'livehouse',
    scopeColumn: null,
    columns: [
      { key: 'name', label: '店名', type: 'text', width: 'w-48' },
      { key: 'prefecture_or_state', label: '都道府県・州', type: 'text', width: 'w-32' },
      { key: 'city', label: '市区町村', type: 'text', width: 'w-32' },
      { key: 'address', label: '住所', type: 'text' },
      { key: 'country', label: '国', type: 'text', width: 'w-24' },
      { key: 'latitude', label: '緯度', type: 'number', width: 'w-28' },
      { key: 'longitude', label: '経度', type: 'number', width: 'w-28' },
      { key: 'hours', label: '営業時間', type: 'text', width: 'w-32' },
      { key: 'url', label: 'URL', type: 'text', width: 'w-48' },
    ],
    required: ['name'],
    orderBy: [{ column: 'name', ascending: true }],
  },
  recordshop: {
    table: 'recordshop',
    scopeColumn: null,
    columns: [
      { key: 'name', label: '店名', type: 'text', width: 'w-48' },
      { key: 'prefecture_or_state', label: '都道府県・州', type: 'text', width: 'w-32' },
      { key: 'city', label: '市区町村', type: 'text', width: 'w-32' },
      { key: 'address', label: '住所', type: 'text' },
      { key: 'country', label: '国', type: 'text', width: 'w-24' },
      { key: 'latitude', label: '緯度', type: 'number', width: 'w-28' },
      { key: 'longitude', label: '経度', type: 'number', width: 'w-28' },
      { key: 'hours', label: '営業時間', type: 'text', width: 'w-32' },
      { key: 'official_site_url', label: '公式サイト', type: 'text', width: 'w-48' },
      { key: 'sns_x_url', label: 'X', type: 'text', width: 'w-40' },
      { key: 'sns_instagram_url', label: 'Instagram', type: 'text', width: 'w-40' },
    ],
    required: ['name'],
    orderBy: [{ column: 'name', ascending: true }],
  },
  venue: {
    table: 'venue_location',
    scopeColumn: null,
    columns: [
      { key: 'venue_name', label: '会場名', type: 'text' },
      { key: 'latitude', label: '緯度', type: 'number', width: 'w-32' },
      { key: 'longitude', label: '経度', type: 'number', width: 'w-32' },
      { key: 'source', label: '出典', type: 'text', width: 'w-40' },
    ],
    required: ['venue_name'],
    orderBy: [{ column: 'venue_name', ascending: true }],
  },
  syncWork: {
    table: 'sync_work',
    scopeColumn: null,
    columns: [
      { key: 'title', label: '作品名', type: 'text' },
      {
        key: 'work_type',
        label: '種別',
        type: 'select',
        options: [
          { value: 'cm', label: 'CM' },
          { value: 'anime', label: 'アニメ' },
          { value: 'game', label: 'ゲーム' },
          { value: 'movie', label: '映画' },
          { value: 'tv_program', label: 'テレビ番組' },
        ],
        width: 'w-32',
      },
      { key: 'company_or_studio', label: '企業・制作', type: 'text', width: 'w-48' },
      { key: 'year', label: '年', type: 'number', width: 'w-24' },
      { key: 'entries', label: '', type: 'link', href: '/admin/data/sync/work/{id}/grid', text: '起用曲を表で編集 →', width: 'w-40' },
    ],
    required: ['title'],
    orderBy: [{ column: 'title', ascending: true }],
  },
  syncEntry: {
    table: 'sync_entry',
    scopeColumn: 'sync_work_id',
    columns: [
      { key: 'target', label: '起用曲', type: 'target', kinds: ['track'] },
      { key: 'usage_detail', label: '使われ方(OP/ED/CM名など)', type: 'text', width: 'w-72' },
    ],
    required: ['target'],
    orderBy: [{ column: 'created_at', ascending: true }],
  },
  musicEvent: {
    table: 'music_event',
    scopeColumn: null,
    columns: [
      { key: 'target', label: 'アーティスト', type: 'target', kinds: ['artist'] },
      { key: 'name', label: '公演名', type: 'text', width: 'w-56' },
      { key: 'event_date', label: '日付', type: 'date', width: 'w-36' },
      { key: 'venue', label: '会場', type: 'text', width: 'w-48' },
      { key: 'prefecture', label: '都道府県', type: 'select', optionsFrom: 'prefectures', width: 'w-32' },
      { key: 'description', label: '説明', type: 'text', width: 'w-64' },
    ],
    required: ['name'],
    orderBy: [{ column: 'event_date', ascending: false }],
  },
  artist: {
    table: 'artist',
    scopeColumn: null,
    columns: [
      { key: 'name', label: '名前', type: 'text', width: 'w-56' },
      { key: 'name_kana', label: '読み', type: 'text', width: 'w-48' },
      { key: 'name_en', label: '英語名', type: 'text', width: 'w-48' },
      { key: 'artist_type', label: '形態', type: 'select', options: options(ARTIST_TYPE_LABEL), width: 'w-28' },
      { key: 'formed_year', label: '結成・デビュー年', type: 'number', width: 'w-28' },
      { key: 'hometown_city', label: '出身地(都市)', type: 'text', width: 'w-36' },
      { key: 'streaming_status', label: 'サブスク', type: 'select', options: options(ARTIST_STREAMING_STATUS_LABEL), width: 'w-24' },
      { key: 'official_site_url', label: '公式サイト', type: 'text', width: 'w-56' },
      { key: 'sns_x_url', label: 'X', type: 'text', width: 'w-48' },
      { key: 'sns_instagram_url', label: 'Instagram', type: 'text', width: 'w-48' },
    ],
    required: ['name'],
    orderBy: [{ column: 'sort_key', ascending: true }],
    allowInsert: false,
    allowDelete: false,
    search: { columns: ['name', 'name_kana', 'name_en'], limit: 200, placeholder: '名前・読み・英語名で検索' },
    presets: [
      { key: 'no-kana', label: '読みなし', apply: (q) => q.is('name_kana', null) },
      { key: 'no-site', label: '公式サイトなし', apply: (q) => q.is('official_site_url', null) },
      { key: 'no-apple', label: 'Apple Music未紐付け', apply: (q) => q.is('apple_music_artist_id', null) },
    ],
    note: 'アーティストの追加はApple Musicからの登録、統合・削除は重複レビュー画面で行います。',
  },
  album: {
    table: 'album',
    scopeColumn: null,
    columns: [
      { key: 'target', label: 'アーティスト', type: 'target', kinds: ['artist'] },
      { key: 'title', label: 'タイトル', type: 'text', width: 'w-64' },
      { key: 'title_kana', label: '読み', type: 'text', width: 'w-40' },
      {
        key: 'album_type',
        label: '種別',
        type: 'select',
        options: ALBUM_TYPE_ORDER.map((v) => ({ value: v, label: ALBUM_TYPE_LABEL_JA[v] })),
        width: 'w-36',
      },
      { key: 'release_date', label: '発売日', type: 'date', width: 'w-36' },
      { key: 'catalog_number', label: '品番', type: 'text', width: 'w-32' },
      {
        key: 'streaming_status',
        label: '配信状況',
        type: 'select',
        options: Object.entries(STREAMING_STATUS_LABEL).map(([value, v]) => ({ value, label: v.label })),
        width: 'w-36',
      },
      { key: 'tower_url', label: 'タワレコURL', type: 'text', width: 'w-48' },
      { key: 'discogs_url', label: 'Discogs URL', type: 'text', width: 'w-48' },
    ],
    required: ['title', 'target'],
    orderBy: [{ column: 'release_date', ascending: false }],
    allowInsert: false,
    allowDelete: false,
    search: { columns: ['title', 'title_kana', 'catalog_number'], limit: 200, placeholder: 'タイトル・読み・品番で検索' },
    presets: [
      { key: 'stub', label: '最小限登録(配信なし・手がかりなし)', apply: (q) => q.eq('streaming_status', 'unreleased') },
      { key: 'no-date', label: '発売日なし', apply: (q) => q.is('release_date', null) },
    ],
    note: 'アルバムの追加はApple Music等からの登録で行います。アーティストを変える時は、同名の別人と取り違えていないか確認してください。',
  },
  track: {
    table: 'track',
    scopeColumn: null,
    columns: [
      { key: 'target', label: 'アーティスト', type: 'target', kinds: ['artist'] },
      { key: 'title', label: '曲名', type: 'text', width: 'w-64' },
      { key: 'disc_number', label: 'ディスク', type: 'number', width: 'w-20' },
      { key: 'track_no', label: '曲順', type: 'number', width: 'w-20' },
      { key: 'youtube_video_id', label: 'YouTube動画ID', type: 'text', width: 'w-40' },
      { key: 'lyric_url', label: '歌詞URL', type: 'text', width: 'w-48' },
    ],
    required: ['title', 'target'],
    orderBy: [{ column: 'title', ascending: true }],
    allowInsert: false,
    allowDelete: false,
    search: { columns: ['title'], limit: 200, placeholder: '曲名で検索' },
    presets: [{ key: 'no-mv', label: 'MV未設定', apply: (q) => q.is('youtube_video_id', null) }],
    note: '曲の追加はアルバム単位(Apple Music等からの登録)で行います。',
  },
  rankingList: {
    table: 'ranking',
    scopeColumn: null,
    columns: [
      { key: 'name', label: '企画名', type: 'text', width: 'w-64' },
      { key: 'source', label: '発表元', type: 'text', width: 'w-36' },
      {
        key: 'list_type',
        label: '形式',
        type: 'select',
        options: [
          { value: 'selection', label: '選出(順位なし)' },
          { value: 'ranked', label: 'ランキング(順位あり)' },
        ],
        width: 'w-44',
      },
      { key: 'description', label: '説明', type: 'text' },
      { key: 'source_url', label: '出典URL', type: 'text', width: 'w-56' },
      { key: 'image_url', label: '画像URL', type: 'text', width: 'w-48' },
      { key: 'entries', label: '', type: 'link', href: '/admin/data/curation/{id}/grid', text: '選出を表で編集 →', width: 'w-36' },
    ],
    required: ['name', 'list_type'],
    orderBy: [{ column: 'name', ascending: true }],
    allowDelete: false,
    note: '企画を削除すると選出作品も一緒に消えるため、この表からは削除できません(キュレーション画面から行います)。',
  },
  discGuideList: {
    table: 'disc_guide',
    scopeColumn: null,
    columns: [
      { key: 'title', label: '書名', type: 'text', width: 'w-72' },
      { key: 'publisher', label: '出版社', type: 'text', width: 'w-40' },
      { key: 'published_year', label: '発行年', type: 'number', width: 'w-24' },
      { key: 'isbn', label: 'ISBN', type: 'text', width: 'w-40' },
      { key: 'tower_url', label: 'タワレコURL', type: 'text' },
      { key: 'selections', label: '', type: 'link', href: '/admin/data/discguides/{id}/grid', text: '掲載作品を表で編集 →', width: 'w-44' },
    ],
    required: ['title'],
    orderBy: [{ column: 'title', ascending: true }],
    allowDelete: false,
    note: '本を削除すると掲載作品と読み取り結果も一緒に消えるため、この表からは削除できません。',
  },
  festivalList: {
    table: 'event',
    scopeColumn: null,
    columns: [
      { key: 'name', label: 'フェス名', type: 'text', width: 'w-56' },
      { key: 'name_ja', label: '日本語名', type: 'text', width: 'w-48' },
      {
        key: 'event_type',
        label: '種別',
        type: 'select',
        options: [
          { value: 'festival', label: 'フェス' },
          { value: 'one_off_live', label: '単発イベント' },
          { value: 'tour', label: 'ツアー' },
          { value: 'other', label: 'その他' },
        ],
        width: 'w-32',
      },
      { key: 'founded_year', label: '初開催', type: 'number', width: 'w-24' },
      { key: 'country', label: '国', type: 'text', width: 'w-24' },
      { key: 'prefecture', label: '都道府県', type: 'select', optionsFrom: 'prefectures', width: 'w-32' },
      { key: 'official_site_url', label: '公式サイト', type: 'text', width: 'w-56' },
      { key: 'description', label: '説明', type: 'text', width: 'w-64' },
      { key: 'editions', label: '', type: 'link', href: '/admin/data/events/event/{id}/editions-grid', text: '開催回を表で編集 →', width: 'w-40' },
    ],
    required: ['name'],
    orderBy: [{ column: 'name', ascending: true }],
    allowDelete: false,
    note: 'フェスを削除すると開催回・出演者も一緒に消えるため、この表からは削除できません(イベント画面から行います)。',
  },
  festivalEdition: {
    table: 'event_edition',
    scopeColumn: 'event_id',
    columns: [
      { key: 'year', label: '開催年', type: 'number', width: 'w-24' },
      { key: 'start_date', label: '開始日', type: 'date', width: 'w-36' },
      { key: 'end_date', label: '終了日', type: 'date', width: 'w-36' },
      { key: 'venue', label: '会場', type: 'text', width: 'w-56' },
      { key: 'description', label: '概要', type: 'text' },
      { key: 'lineup', label: '', type: 'link', href: '/admin/data/events/edition/{id}/grid', text: '出演者 →', width: 'w-24' },
      { key: 'dates', label: '', type: 'link', href: '/admin/data/events/edition/{id}/dates-grid', text: '日程 →', width: 'w-20' },
    ],
    required: ['year'],
    orderBy: [{ column: 'year', ascending: false }],
    allowDelete: false,
    note: '開催回を削除すると出演者・日程も一緒に消えるため、この表からは削除できません(フェスの編集画面から行います)。',
  },
  awardList: {
    table: 'award',
    scopeColumn: null,
    columns: [
      { key: 'name', label: 'アワード名', type: 'text', width: 'w-64' },
      { key: 'country', label: '国', type: 'text', width: 'w-28' },
      { key: 'description', label: '説明', type: 'text' },
      { key: 'entries', label: '', type: 'link', href: '/admin/data/awards/{id}/grid', text: '受賞・ノミネートを表で編集 →', width: 'w-56' },
    ],
    required: ['name'],
    orderBy: [{ column: 'name', ascending: true }],
    allowDelete: false,
    note: 'アワードを削除すると受賞・ノミネートも一緒に消えるため、この表からは削除できません。',
  },
} satisfies Record<string, TableConfig>

export type GridTableKey = keyof typeof GRID_TABLES

export function getTableConfig(key: string): TableConfig {
  const config = (GRID_TABLES as Record<string, TableConfig>)[key]
  if (!config) throw new Error(`未対応の表です: ${key}`)
  return config
}

/** optionsFromで指定された選択肢を読み込み、クライアントへ渡せる形(optionsのみ)にする */
export async function resolveColumns(config: TableConfig): Promise<ColumnDef[]> {
  const needsStations = config.columns.some((c) => c.type === 'select' && c.optionsFrom === 'radioStations')
  const stations = needsStations
    ? ((await createAdminClient().from('media').select('id, name').order('name')).data ?? [])
    : []
  return config.columns.map((c) => {
    if (c.type !== 'select' || !c.optionsFrom) return c
    const resolved =
      c.optionsFrom === 'prefectures'
        ? PREFECTURE_COORDS.map((p) => ({ value: p.name, label: p.name }))
        : stations.map((s) => ({ value: s.id as string, label: s.name as string }))
    return { key: c.key, label: c.label, type: 'select', options: resolved, width: c.width }
  })
}

type Joined = { id: string; title?: string; name?: string; artist?: { name: string } | { name: string }[] | null }
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

export function targetLabel(kind: TargetKind, row: Joined): string {
  if (kind === 'artist') return row.name ?? ''
  const artist = one(row.artist)
  return `${row.title ?? ''}${artist?.name ? ` — ${artist.name}` : ''}`
}

/** PostgRESTの.or()は「,」「(」「)」を区切りとして解釈するため、検索語から取り除く */
function sanitizeSearch(q: string): string {
  return q.replace(/[,()]/g, ' ').trim()
}

/** 表の初期表示用に行を読み込む。scopeIdで親を絞り、検索付きの表はq/presetで絞って上位limit件を返す */
export async function loadGridRows(
  key: GridTableKey,
  scopeId: string | null,
  opts: { q?: string; preset?: string } = {}
): Promise<{ rows: GridRow[]; truncated: boolean }> {
  const config = getTableConfig(key)
  const target = config.columns.find((c) => c.type === 'target') as Extract<ColumnDef, { type: 'target' }> | undefined
  const plain = config.columns.filter((c) => c.type !== 'target' && c.type !== 'link').map((c) => c.key)
  const joins = (target?.kinds ?? []).map((kind) =>
    kind === 'artist'
      ? 'artist:artist_id(id, name)'
      : `${kind}:${TARGET_COLUMNS[kind]}(id, title, artist:artist_id(name))`
  )
  const select = ['id', ...plain, ...joins].join(', ')
  const limit = config.search?.limit ?? Infinity
  const q = sanitizeSearch(opts.q ?? '')
  const preset = config.presets?.find((p) => p.key === opts.preset)

  const supabase = createAdminClient()
  const rows: GridRow[] = []
  let truncated = false
  for (let from = 0; rows.length < limit; from += 1000) {
    let query: Query = supabase.from(config.table).select(select)
    if (config.scopeColumn) query = query.eq(config.scopeColumn, scopeId)
    if (q && config.search) query = query.or(config.search.columns.map((c) => `${c}.ilike.%${q}%`).join(','))
    if (preset) query = preset.apply(query)
    for (const o of config.orderBy) query = query.order(o.column, { ascending: o.ascending, nullsFirst: false })
    query = query.order('id', { ascending: true })
    // 上限を超えるかどうかを知るため、上限+1件まで取る
    const to = Math.min(from + 999, Number.isFinite(limit) ? limit : from + 999)
    const { data, error } = await query.range(from, to)
    if (error) throw new Error(`読み込みに失敗しました: ${error.message}`)
    const page = (data ?? []) as Record<string, unknown>[]
    for (const r of page) {
      if (rows.length >= limit) {
        truncated = true
        break
      }
      let t: GridTarget | null = null
      for (const kind of target?.kinds ?? []) {
        const joined = one(r[kind] as Joined | Joined[] | null)
        if (joined) {
          t = { kind, id: joined.id, label: targetLabel(kind, joined) }
          break
        }
      }
      rows.push({
        key: String(r.id),
        id: String(r.id),
        values: Object.fromEntries(plain.map((k) => [k, (r[k] as CellValue) ?? null])),
        target: t,
      })
    }
    if (page.length < to - from + 1) break
  }
  return { rows, truncated }
}
