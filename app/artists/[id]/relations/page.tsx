import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import RelationGraph, { type RelationEdge, type RelationNode } from '@/app/components/RelationGraph'

export default async function ArtistRelationsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: artist, error } = await supabase.from('artist').select('id, name').eq('id', id).single()

  if (error || !artist) {
    notFound()
  }

  const { data: relations } = await supabase
    .from('artist_relation')
    .select('artist_id_a, artist_id_b, relation_type, relation_style, description')
    .or(`artist_id_a.eq.${id},artist_id_b.eq.${id}`)

  const otherIds = Array.from(
    new Set((relations ?? []).map((r) => (r.artist_id_a === id ? r.artist_id_b : r.artist_id_a)))
  )

  const { data: others } = otherIds.length
    ? await supabase.from('artist').select('id, name').in('id', otherIds)
    : { data: [] }

  const allIds = [id, ...otherIds]
  const { data: artistGenres } = await supabase
    .from('artist_genre')
    .select('artist_id, genre:genre_id(name)')
    .in('artist_id', allIds)

  const categoryByArtist = new Map<string, string>()
  for (const row of artistGenres ?? []) {
    if (categoryByArtist.has(row.artist_id)) continue
    const genre = Array.isArray(row.genre) ? row.genre[0] : row.genre
    if (genre?.name) categoryByArtist.set(row.artist_id, genre.name)
  }

  const nodes: RelationNode[] = [artist, ...(others ?? [])].map((a) => ({
    id: a.id,
    name: a.name,
    category: categoryByArtist.get(a.id) ?? null,
  }))
  const edges: RelationEdge[] = (relations ?? []).map((r) => ({
    source: r.artist_id_a,
    target: r.artist_id_b,
    style: (r.relation_style as 'solid' | 'dotted') ?? 'solid',
    label: r.description ?? r.relation_type,
  }))

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link href={`/artists/${artist.id}`} className="text-xs text-white/40 hover:text-white/70">
        ← {artist.name}
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{artist.name} の相関図</h1>
      <p className="mt-2 text-sm text-white/50">
        実線は在籍/制作/コラボ、点線はジャンル・シーンや影響関係を表します。
      </p>

      <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.02]">
        <RelationGraph nodes={nodes} edges={edges} centerId={artist.id} />
      </div>
    </div>
  )
}
