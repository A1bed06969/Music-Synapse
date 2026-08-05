import { createClient } from '@/utils/Supabase/server'
import RelationGraph, { type RelationEdge, type RelationNode } from '@/app/components/RelationGraph'

export default async function RelationsPage() {
  const supabase = await createClient()

  const [{ data: artists }, { data: relations }, { data: artistGenres }] = await Promise.all([
    supabase.from('artist').select('id, name'),
    supabase
      .from('artist_relation')
      .select('artist_id_a, artist_id_b, relation_type, relation_style, description'),
    supabase.from('artist_genre').select('artist_id, genre:genre_id(name)'),
  ])

  const categoryByArtist = new Map<string, string>()
  for (const row of artistGenres ?? []) {
    if (categoryByArtist.has(row.artist_id)) continue
    const genre = Array.isArray(row.genre) ? row.genre[0] : row.genre
    if (genre?.name) categoryByArtist.set(row.artist_id, genre.name)
  }

  const nodes: RelationNode[] = (artists ?? []).map((a) => ({
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
      <h1 className="text-2xl font-bold">総合音楽相関図</h1>
      <p className="mt-2 text-sm text-white/50">
        全アーティストを横断したつながりのネットワーク。実線は在籍/制作/コラボ、点線はジャンル・シーンや影響関係を表します。同じジャンルのアーティストは色分けされたエリアにまとまって配置されます。ノードをクリックするとアーティストページへ移動します。
      </p>

      <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.02]">
        <RelationGraph nodes={nodes} edges={edges} />
      </div>
    </div>
  )
}
