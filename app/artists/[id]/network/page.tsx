import { createClient } from '@/utils/Supabase/server'
import RelationGraph, { type RelationNode, type RelationEdge } from '@/app/components/RelationGraph'
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

  const { data: artist } = await supabase.from('artist').select('id, name, image_url').eq('id', id).single()
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

  const nodes: RelationNode[] = artist
    ? [
        { id: artist.id, name: artist.name, imageUrl: artist.image_url, type: 'artist' },
        ...relations.map((r) => ({ id: r.otherArtistId, name: r.otherArtistName, imageUrl: r.otherArtistImageUrl, type: 'artist' as const })),
      ]
    : []
  const edges: RelationEdge[] = relations.map((r) => ({
    source: id,
    target: r.otherArtistId,
    style: 'solid',
    label: r.description,
  }))

  return (
    <div>
      <h2 className="text-xs uppercase tracking-wide text-white/40">Artist Network</h2>
      <div className="mt-4 hidden lg:block">
        {relations.length === 0 ? (
          <p className="text-sm text-white/40">登録されている関係性はありません。</p>
        ) : (
          <RelationGraph nodes={nodes} edges={edges} centerId={id} />
        )}
      </div>
      <div className="lg:hidden">
        <ArtistNetworkList relations={relations} />
      </div>
    </div>
  )
}
