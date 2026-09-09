import { createClient } from '@/utils/Supabase/server'
import ArtistNetworkList, { type NetworkRelation } from '@/app/components/artist-detail/ArtistNetworkList'

type RelationRow = {
  id: number
  relation_type: string
  description: string | null
  artist_id_a: string
  artist_id_b: string
  a: { id: string; name: string; image_url: string | null } | { id: string; name: string; image_url: string | null }[] | null
  b: { id: string; name: string; image_url: string | null } | { id: string; name: string; image_url: string | null }[] | null
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

export default async function NetworkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: relationRows } = await supabase
    .from('artist_relation')
    .select('id, relation_type, description, artist_id_a, artist_id_b, a:artist_id_a(id, name, image_url), b:artist_id_b(id, name, image_url)')
    .in('relation_type', ['membership', 'production'])
    .or(`artist_id_a.eq.${id},artist_id_b.eq.${id}`)
    .overrideTypes<RelationRow[], { merge: false }>()

  const relations: NetworkRelation[] = (relationRows ?? [])
    .map((row) => {
      const a = firstOf(row.a)
      const b = firstOf(row.b)
      const other = row.artist_id_a === id ? b : a
      if (!other || (row.relation_type !== 'membership' && row.relation_type !== 'production')) return null
      return {
        id: String(row.id),
        otherArtistId: other.id,
        otherArtistName: other.name,
        otherArtistImageUrl: other.image_url,
        relationType: row.relation_type,
        description: row.description,
      }
    })
    .filter((r): r is NetworkRelation => r !== null)

  return (
    <div>
      <h2 className="text-xs uppercase tracking-wide text-white/40">Artist Network</h2>
      {/* RelationGraphのEgoTree表示は、このセクションの幅(CENTERカラム)だと
       * ノードラベルが判読できないほど縮小されてしまう問題があり、対応する
       * まで一旦リスト表示のみにしている(デスクトップ/モバイル共通)。 */}
      <ArtistNetworkList relations={relations} />
    </div>
  )
}
