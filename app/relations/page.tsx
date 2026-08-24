import { createClient } from '@/utils/Supabase/server'
import RelationGraph, { type RelationEdge, type RelationNode } from '@/app/components/RelationGraph'

const PAGE_SIZE = 1000

type ArtistRow = { id: string; name: string; image_url: string | null }

async function fetchAllArtists(supabase: Awaited<ReturnType<typeof createClient>>): Promise<ArtistRow[]> {
  const rows: ArtistRow[] = []
  let offset = 0
  // アーティスト総数がPostgRESTの1回あたり上限(1000件)を超えたためページングする
  // (この上限のせいで最近登録されたアーティストが相関図に出ない不具合が実際に発生した)
  while (true) {
    const { data } = await supabase.from('artist').select('id, name, image_url').range(offset, offset + PAGE_SIZE - 1)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return rows
}

export default async function RelationsPage() {
  const supabase = await createClient()

  const [artists, { data: relations }, { data: artistGenres }] = await Promise.all([
    fetchAllArtists(supabase),
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
