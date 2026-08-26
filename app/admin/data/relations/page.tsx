import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { fetchAllRows } from '@/utils/fetchAllRows'
import { inputClass, buttonClass } from '../adminUi'
import SearchableSelect from '../SearchableSelect'
import { searchArtists } from '../actions'
import { createRelation } from './actions'
import RelationListClient from './RelationListClient'

const RELATION_TYPE_OPTIONS = [
  { value: 'membership', label: '在籍・メンバー(実線)' },
  { value: 'production', label: '制作(実線)' },
  { value: 'collaboration', label: 'コラボ(実線)' },
  { value: 'genre_scene', label: 'ジャンル・シーン(点線)' },
  { value: 'influence', label: '影響関係(点線)' },
  { value: 'sync_costar', label: 'タイアップ共演(点線)' },
]

export default async function RelationsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  type RelationRow = {
    id: number
    relation_type: string
    relation_style: string | null
    description: string | null
    artist_a: { name: string } | { name: string }[] | null
    artist_b: { name: string } | { name: string }[] | null
  }

  // artist_relationは1675件でPostgRESTの上限(1000件)を超えており、単純な.select()
  // だと後半の相関が一覧から丸ごと消えていた
  const relations = await fetchAllRows<RelationRow>(
    supabase,
    'artist_relation',
    'id, relation_type, relation_style, description, artist_a:artist_id_a(name), artist_b:artist_id_b(name)',
    'id'
  )

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <div className="mt-4 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">相関図データ</h1>
        <Link href="/relations" className="text-xs text-white/40 hover:text-white/70">
          公開ページを見る →
        </Link>
      </div>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <form action={createRelation} className="mt-6 space-y-2">
        <div className="flex flex-wrap gap-2">
          <SearchableSelect searchAction={searchArtists} name="artist_id_a" placeholder="アーティストAを検索..." />
          <SearchableSelect searchAction={searchArtists} name="artist_id_b" placeholder="アーティストBを検索..." />
          <select name="relation_type" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              関係の種類
            </option>
            {RELATION_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <input name="description" placeholder="説明(任意。例: 同じレーベル在籍)" className={inputClass} />
        <button type="submit" className={buttonClass}>
          相関を追加
        </button>
      </form>

      {relations.length > 0 && (
        <RelationListClient
          rows={relations.map((row) => {
            const a = Array.isArray(row.artist_a) ? row.artist_a[0] : row.artist_a
            const b = Array.isArray(row.artist_b) ? row.artist_b[0] : row.artist_b
            return {
              id: row.id,
              artistAName: a?.name ?? '',
              artistBName: b?.name ?? '',
              dotted: row.relation_style === 'dotted',
              relationType: row.relation_type,
              description: row.description,
            }
          })}
        />
      )}
    </div>
  )
}
