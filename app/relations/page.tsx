import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { fetchConnectData } from '@/utils/connectGraph'
import ConnectView from '@/app/components/connect/ConnectView'

// 最初に開いたときの例と、「たとえば」の候補(名前で引く)
const START = '星野源'
const EXAMPLES = ['星野源', '宇多田ヒカル', 'KREVA', '椎名林檎', '布袋寅泰', '米津玄師', 'Creepy Nuts', 'SIRUP']

export const metadata = { title: 'Connect The Music Makers | Music Synapse' }

/** Connect The Music Makers の入口。検索欄と、例として1人の相関図を出す */
export default async function ConnectTopPage() {
  const supabase = await createClient()
  const { data: rows } = await supabase.from('artist').select('id, name').in('name', EXAMPLES).not('apple_music_artist_id', 'is', null)
  const examples = EXAMPLES.map((n) => (rows ?? []).find((r) => r.name === n)).filter((r): r is { id: string; name: string } => !!r)
  const start = examples.find((e) => e.name === START) ?? examples[0]
  const data = start ? await fetchConnectData(supabase, start.id) : null

  const intro = (
    <div className="grid gap-2">
      <p className="flex flex-wrap items-center gap-2 text-xs text-white/45">
        たとえば
        {examples.map((e) => (
          <Link key={e.id} href={`/relations/${e.id}`} className="rounded-full border border-white/15 px-3 py-1 text-white/75 hover:border-white/40 hover:text-white">
            {e.name}
          </Link>
        ))}
      </p>
    </div>
  )

  if (!data) {
    return <div className="mx-auto max-w-[1280px] px-4 py-10 text-sm text-white/60">相関図のデータがまだありません。</div>
  }
  return <ConnectView data={data} intro={intro} sample />
}
