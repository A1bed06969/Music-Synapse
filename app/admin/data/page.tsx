import { createClient } from '@/utils/Supabase/server'
import { fetchAllRows } from '@/utils/fetchAllRows'
import SearchableSelect from './SearchableSelect'
import AdminArtistSearchList from './AdminArtistSearchList'
import { searchArtists, mergeArtist } from './actions'

export default async function AdminDataPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()
  // 2026年8月時点でアーティスト総数がPostgRESTの1リクエストあたり行数上限(既定1000件)を
  // 超えており、単純な.select()だと後半のアーティストが一覧から丸ごと消えていた
  const artistOptions = await fetchAllRows<{ id: string; name: string }>(supabase, 'artist', 'id, name', 'name')

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">手動データ登録</h1>
      <p className="mt-2 text-sm text-white/50">
        ジャンル・相関図・レーベルなど、自動同期できない編集データを登録します。各機能は左のメニューから。
      </p>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">アーティスト</h2>
        <p className="mt-2 text-xs text-white/40">
          プロフィール項目(bio・URL・配信状況等)の編集はこちらから。新規登録はiTunes一括登録のみ対応。
        </p>
        <div className="mt-4">
          <AdminArtistSearchList artists={artistOptions} />
        </div>
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
