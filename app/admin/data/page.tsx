import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import SearchableSelect from './SearchableSelect'
import { searchArtists, mergeArtist } from './actions'

const SECTION_LINKS = [
  { href: '/admin/data/genres', label: 'ジャンル', description: 'ジャンルの登録・アーティストへの紐付け' },
  { href: '/admin/data/relations', label: '相関図データ', description: 'アーティスト間の関係(相関図の元データ)' },
  { href: '/admin/data/labels', label: 'レーベル', description: 'レーベル登録・アーティスト/アルバムの所属紐付け' },
  { href: '/admin/data/media', label: 'メディア&オンエア', description: 'メディア・番組登録、パワープレイ/ヘビロテ実績' },
  { href: '/admin/data/curation', label: 'キュレーションコンテンツ', description: 'メディア企画・ランキング掲載' },
  { href: '/admin/data/sync', label: 'タイアップ・シンクロアーカイブ', description: 'CM/アニメ/映画等での楽曲起用' },
  { href: '/admin/data/events', label: 'イベント', description: 'フェス・開催回・出演情報・単独公演' },
  { href: '/admin/data/awards', label: 'アワード', description: '受賞・ノミネート履歴' },
  { href: '/admin/data/discguides', label: 'ディスクガイド', description: '書籍情報・アルバムの掲載データ' },
]

const TOOL_LINKS = [
  { href: '/admin/data/shops', label: 'レコードショップ登録' },
  { href: '/admin/data/livehouses', label: 'ライブハウス登録' },
  { href: '/admin/data/venues', label: '会場の座標登録' },
  { href: '/admin/data/artists/geo', label: 'アーティスト座標を一括更新' },
  { href: '/admin/data/artists/images', label: 'アーティスト画像を一括更新' },
  { href: '/admin/data/artists/unreleased', label: '未解禁アーティスト検出' },
  { href: '/admin/data/artists/musicbrainz-queue', label: 'MusicBrainzプロフィール未解決アーティスト' },
  { href: '/admin/data/media/radio-pilot', label: 'ラジオ局PP収集(パイロット)' },
  { href: '/admin/import', label: 'iTunes一括登録へ →' },
  { href: '/admin/import/search', label: '検索してアーティスト/アルバム/トラックを登録' },
]

export default async function AdminDataPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()
  const { data: artists } = await supabase.from('artist').select('id, name').order('name')
  const artistOptions = artists ?? []

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">手動データ登録</h1>
      <p className="mt-2 text-sm text-white/50">
        ジャンル・相関図・レーベルなど、自動同期できない編集データをここから登録します。
      </p>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <section className="mt-8">
        <div className="flex flex-wrap gap-2">
          {TOOL_LINKS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/60 hover:border-white/30 hover:text-white"
            >
              {t.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-10 border-t border-white/10 pt-8">
        <h2 className="text-lg font-semibold">データ登録セクション</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {SECTION_LINKS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="block rounded-lg border border-white/10 bg-white/[0.03] p-4 transition hover:bg-white/[0.06]"
            >
              <p className="font-semibold">{s.label}</p>
              <p className="mt-1 text-xs text-white/50">{s.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-10 border-t border-white/10 pt-8">
        <h2 className="text-lg font-semibold">アーティスト</h2>
        <p className="mt-2 text-xs text-white/40">
          プロフィール項目(bio・URL・配信状況等)の編集はこちらから。新規登録はiTunes一括登録のみ対応。
        </p>
        {artistOptions.length === 0 ? (
          <p className="mt-4 text-sm text-white/40">まだアーティストが登録されていません。</p>
        ) : (
          <ul className="mt-4 divide-y divide-white/10">
            {artistOptions.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                <span>{a.name}</span>
                <Link href={`/admin/data/artists/${a.id}/edit`} className="text-xs text-white/40 hover:text-white/70">
                  編集 →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 rounded-md border border-red-500/20 p-4">
        <h2 className="text-sm font-semibold">アーティスト統合</h2>
        <p className="mt-1 text-xs text-white/40">
          自動登録(iTunes)と手動登録などで重複した2件を1件へまとめる。統合元のアルバム・トラック・ジャンル・関係性・フェス出演歴・受賞歴・クレジット等は全て統合先へ付け替わり、統合元は削除される。取り消せない操作。
          Apple Music IDが設定されている方は、選んだ向きに関わらず自動的に統合先(残す方)になる。
        </p>
        <form action={mergeArtist} className="mt-3 flex flex-wrap items-center gap-2">
          <SearchableSelect
            searchAction={searchArtists}
            name="source_artist_id"
            placeholder="統合元(削除する方)を検索..."
          />
          <span className="text-xs text-white/40">を</span>
          <SearchableSelect
            searchAction={searchArtists}
            name="target_artist_id"
            placeholder="統合先(残す方)を検索..."
          />
          <span className="text-xs text-white/40">へ統合</span>
          <button type="submit" className="rounded-md border border-red-500/30 px-4 py-2 text-sm hover:bg-red-500/10">
            統合する
          </button>
        </form>
      </section>
    </div>
  )
}
