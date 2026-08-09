import type { SupabaseClient } from '@supabase/supabase-js'
import type { RelationNode, RelationEdge } from '@/app/components/RelationGraph'
import { CREDIT_ROLE_LABEL } from '@/utils/format'

export async function buildArtistRelationGraph(
  supabase: SupabaseClient,
  artistId: string,
  artistName: string
): Promise<{ nodes: RelationNode[]; edges: RelationEdge[] }> {
  const { data: relations } = await supabase
    .from('artist_relation')
    .select('artist_id_a, artist_id_b, relation_type, relation_style, description')
    .or(`artist_id_a.eq.${artistId},artist_id_b.eq.${artistId}`)

  const otherIds = Array.from(
    new Set((relations ?? []).map((r) => (r.artist_id_a === artistId ? r.artist_id_b : r.artist_id_a)))
  )

  const [{ data: others }, { data: artistGenres }, { data: artistCredits }] = await Promise.all([
    otherIds.length
      ? supabase.from('artist').select('id, name').in('id', otherIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabase
      .from('artist_genre')
      .select('artist_id, genre:genre_id(name)')
      .in('artist_id', [artistId, ...otherIds]),
    supabase
      .from('artist_credit')
      .select('id, role, credit_person:credit_person_id(id, name)')
      .eq('artist_id', artistId),
  ])

  const categoryByArtist = new Map<string, string>()
  for (const row of artistGenres ?? []) {
    if (categoryByArtist.has(row.artist_id)) continue
    const genre = Array.isArray(row.genre) ? row.genre[0] : row.genre
    if (genre?.name) categoryByArtist.set(row.artist_id, genre.name)
  }

  const personNodes: RelationNode[] = []
  const personEdges: RelationEdge[] = []
  const seenPersonIds = new Set<string>()
  const seenPersonEdgeKeys = new Set<string>()
  for (const credit of artistCredits ?? []) {
    const person = Array.isArray(credit.credit_person) ? credit.credit_person[0] : credit.credit_person
    if (!person) continue
    if (!seenPersonIds.has(person.id)) {
      seenPersonIds.add(person.id)
      personNodes.push({ id: person.id, name: person.name, category: null, type: 'person' })
    }
    const edgeKey = `${person.id}|${credit.role}`
    if (seenPersonEdgeKeys.has(edgeKey)) continue
    seenPersonEdgeKeys.add(edgeKey)
    personEdges.push({
      source: artistId,
      target: person.id,
      style: 'dotted',
      label: CREDIT_ROLE_LABEL[credit.role] ?? credit.role,
    })
  }

  const nodes: RelationNode[] =
    otherIds.length > 0 || personNodes.length > 0
      ? [
          {
            id: artistId,
            name: artistName,
            category: categoryByArtist.get(artistId) ?? null,
            type: 'artist' as const,
          },
          ...(others ?? []).map((a) => ({
            id: a.id,
            name: a.name,
            category: categoryByArtist.get(a.id) ?? null,
            type: 'artist' as const,
          })),
          ...personNodes,
        ]
      : []

  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges: RelationEdge[] = [
    ...(relations ?? [])
      .filter((r) => nodeIds.has(r.artist_id_a) && nodeIds.has(r.artist_id_b))
      .map((r) => ({
        source: r.artist_id_a,
        target: r.artist_id_b,
        style: (r.relation_style as 'solid' | 'dotted') ?? 'solid',
        label: r.description ?? r.relation_type,
      })),
    ...personEdges.filter((e) => nodeIds.has(e.target)),
  ]

  return { nodes, edges }
}
