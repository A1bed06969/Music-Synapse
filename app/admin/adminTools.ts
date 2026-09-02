// 管理画面の全ツールを一箇所に集約する。サイドバー(AdminSidebarNav)と
// トップページ(data/page.tsx)の両方がこれを参照するため、新しいツールを
// 追加したらここに1件足すだけで両方に反映される。
export type AdminTool = { href: string; label: string; description: string }
export type AdminToolGroup = { label: string; tools: AdminTool[] }

export const ADMIN_TOOL_GROUPS: AdminToolGroup[] = [
  {
    label: '新規登録',
    tools: [
      {
        href: '/admin/import',
        label: 'iTunes一括登録',
        description: 'Apple MusicのアーティストページURLを入力して、アルバム・トラックを一括で取得・登録する。',
      },
      {
        href: '/admin/import/search',
        label: '検索して登録',
        description: 'キーワード検索でアーティスト/アルバム/トラックを個別に登録する。',
      },
      {
        href: '/admin/data/discguides',
        label: 'ディスクガイド',
        description: 'ディスクガイド(書籍等)のスキャンデータを取り込み、確認して登録する。',
      },
    ],
  },
  {
    label: 'アーティスト管理',
    tools: [
      {
        href: '/admin/data',
        label: 'アーティスト検索・編集/統合',
        description: 'プロフィール編集、重複アーティストの統合をこのページ内で行う。',
      },
      {
        href: '/admin/data/artists/review',
        label: '確認待ち一覧',
        description: 'フェス出演・ジャンル年表等で自動登録され、情報が薄いままのアーティストを確認する。',
      },
      {
        href: '/admin/data/artists/unmatched',
        label: '未マッチアーティストを検索',
        description: 'Apple Musicで確証が持てず名前のみで登録されたスタブを検索し、本人に紐付ける。',
      },
      {
        href: '/admin/data/artists/unreleased',
        label: '未解禁アーティスト検出',
        description: 'Discogsにリンクがあるがサブスク配信状況が未設定のアーティスト候補を検出する。',
      },
      {
        href: '/admin/data/artists/musicbrainz-queue',
        label: 'MusicBrainz未解決',
        description: 'アルバムタイトルの自動照合でMBIDを特定できなかったアーティストを手動で解決する。',
      },
      {
        href: '/admin/data/artists/geo',
        label: '座標を一括更新',
        description: 'Wikidata ID登録済みで座標未設定のアーティストに、出身地座標を一括で付与する。',
      },
      {
        href: '/admin/data/artists/images',
        label: '画像を一括更新',
        description: 'Wikidata ID登録済みで画像未設定のアーティストに、Wikimedia Commonsの画像を一括で付与する。',
      },
    ],
  },
  {
    label: 'アルバム・トラック',
    tools: [
      {
        href: '/admin/data/albums/pickup',
        label: '新譜ピックアップ',
        description: 'Discover New Musicの新譜カレンダーに載せる「今週の注目新譜」を紹介文付きで管理する。',
      },
      {
        href: '/admin/data/albums/edition-groups',
        label: 'アルバムの版グループ',
        description: '同一作品の複数エディション(通常盤/限定盤等)をグループ化する。',
      },
    ],
  },
  {
    label: 'イベント・フェス',
    tools: [
      {
        href: '/admin/data/events',
        label: 'イベント',
        description: '音楽イベント・フェスの開催情報と出演者を登録する。',
      },
      {
        href: '/admin/data/events/festival-pilot',
        label: '世界のフェス出演者収集',
        description: '海外フェスのラインナップを取得し、カタログと照合して出演登録する。',
      },
      {
        href: '/admin/data/events/festival-pilot/datasets',
        label: 'フェス出演者データ管理',
        description: '収集したフェス出演者データセットを管理する。',
      },
    ],
  },
  {
    label: 'メディア&オンエア',
    tools: [
      {
        href: '/admin/data/media',
        label: 'メディア&オンエア',
        description: 'ラジオ局・番組・オンエア実績(パワープレイ等)を登録する。',
      },
      {
        href: '/admin/data/media/radio-pilot',
        label: 'ラジオ局PP収集(パイロット)',
        description: 'J-WAVE・FM福井・FMノースウェーブの最新パワープレイ/ヘビーローテーションを取得する。',
      },
      {
        href: '/admin/data/media/radio-airplay-pick',
        label: 'HRPP 手動マッチング',
        description: '収集したパワープレイ候補をカタログのアーティストと手動でマッチングし、本登録する。',
      },
      {
        href: '/admin/data/media/radio-power-play-collect',
        label: 'ラジオ局PP自動収集',
        description: 'URL登録済みの全局のパワープレイ/ヘビーローテーションをGeminiでまとめて抽出し、候補として登録する。',
      },
    ],
  },
  {
    label: 'キュレーション・マスタデータ',
    tools: [
      {
        href: '/admin/data/curation',
        label: 'キュレーションコンテンツ',
        description: 'タワレコメン・Fender NEXT等のランキング/セレクションコンテンツを管理する。',
      },
      {
        href: '/admin/data/genres',
        label: 'ジャンル',
        description: 'ジャンルマスタの管理と、アーティストへのジャンルタグ付け。',
      },
      {
        href: '/admin/data/relations',
        label: '相関図データ',
        description: 'アーティスト相関図に表示する関係性データを登録する。',
      },
      {
        href: '/admin/data/labels',
        label: 'レーベル',
        description: 'レーベルのマスタデータを登録する。',
      },
      {
        href: '/admin/data/sync',
        label: 'タイアップ',
        description: 'CM・ドラマ・アニメ等のタイアップ楽曲情報を登録する。',
      },
      {
        href: '/admin/data/awards',
        label: 'アワード',
        description: '受賞・ノミネート情報をアーティスト/アルバム/トラックに紐付けて登録する。',
      },
    ],
  },
  {
    label: 'ショップ・施設',
    tools: [
      {
        href: '/admin/data/shops',
        label: 'レコードショップの登録',
        description: 'レコードショップの情報を登録する。',
      },
      {
        href: '/admin/data/livehouses',
        label: 'ライブハウスの登録',
        description: 'ライブハウスの情報を登録する。',
      },
      {
        href: '/admin/data/venues',
        label: '会場の座標登録',
        description: 'イベント会場の座標を登録する。',
      },
    ],
  },
]
