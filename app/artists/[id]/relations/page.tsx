import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import RelationGraph from '@/app/components/RelationGraph'
import { buildArtistRelationGraph } from '@/utils/relationGraphData'

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

  const { nodes, edges } = await buildArtistRelationGraph(supabase, artist.id, artist.name)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href={`/artists/${artist.id}`} className="text-xs text-white/40 hover:text-white/70">
        ← {artist.name}
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{artist.name} の相関図</h1>
      <p className="mt-2 text-sm text-white/50">
        実線は在籍/制作/コラボ、点線はジャンル・シーンや影響関係、または制作クレジットを表します。
      </p>

      <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.02]">
        <RelationGraph nodes={nodes} edges={edges} centerId={artist.id} />
      </div>
    </div>
  )
}
