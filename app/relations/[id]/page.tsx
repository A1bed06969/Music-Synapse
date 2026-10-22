import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { fetchConnectData } from '@/utils/connectGraph'
import ConnectView from '@/app/components/connect/ConnectView'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('artist').select('name').eq('id', id).maybeSingle()
  return { title: data ? `${data.name}のコネクト | Music Synapse` : 'Connect The Music Makers | Music Synapse' }
}

/** Connect The Music Makers: 1人を中心にした相関図。まわりの人を押すと、その人の図へ */
export default async function ConnectArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const data = await fetchConnectData(supabase, id)
  if (!data) notFound()
  return <ConnectView data={data} />
}
