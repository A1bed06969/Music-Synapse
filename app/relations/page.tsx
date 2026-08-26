import { createClient } from '@/utils/Supabase/server'
import { fetchAllRows } from '@/utils/fetchAllRows'
import RelationGraph, { type RelationEdge, type RelationNode } from '@/app/components/RelationGraph'

type ArtistRow = { id: string; name: string; image_url: string | null }
type RelationRow = { artist_id_a: string; artist_id_b: string; relation_type: string; relation_style: string | null; description: string | null }
type ArtistGenreRow = { artist_id: string; genre: { name: string } | { name: string }[] | null }

export default async function RelationsPage() {
  const supabase = await createClient()

  // artist_relation(1675件)・artist_genre(1223件)ともにPostgRESTの1回あたり上限
  // (1000件)を超えており、単純な.select()だと後半の関係性・ジャンルが相関図から
  // 丸ごと消えていた(アーティスト自体は既にfetchAllRowsでページング済みだったが、
  // こちらは対応漏れだった)
  const [artists, relations, artistGenres] = await Promise.all([
    fetchAllRows<ArtistRow>(supabase, 'artist', 'id, name, image_url', 'id'),
    fetchAllRows<RelationRow>(supabase, 'artist_relation', 'artist_id_a, artist_id_b, relation_type, relation_style, description', 'id'),
    fetchAllRows<ArtistGenreRow>(supabase, 'artist_genre', 'artist_id, genre:genre_id(name)', 'artist_id'),
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
    imageUrl: a.image_url,
  }))

  const edges: RelationEdge[] = (relations ?? []).map((r) => ({
    source: r.artist_id_a,
    target: r.artist_id_b,
    style: (r.relation_style as 'solid' | 'dotted') ?? 'solid',
    label: r.description ?? r.relation_type,
  }))

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">総合音楽相関図</h1>
      <p className="mt-2 text-sm text-white/50">
        全アーティストを横断したつながりのネットワーク。実線は在籍/制作/コラボ、点線はジャンル・シーンや影響関係を表します。「ジャンル」表示ではジャンルごとに区切って配置、「リレーション」表示では実際に繋がりのあるアーティスト同士をまとめて配置します(ノードの色は常にジャンルを表します)。ノードをクリックするとアーティストページへ移動します。
      </p>

      <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.02]">
        <RelationGraph nodes={nodes} edges={edges} />
      </div>
    </div>
  )
}
