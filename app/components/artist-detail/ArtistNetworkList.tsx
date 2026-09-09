import Link from 'next/link'

export type NetworkRelation = {
  id: string
  otherArtistId: string
  otherArtistName: string
  otherArtistImageUrl: string | null
  relationType: 'membership' | 'production'
  description: string | null
}

const RELATION_TYPE_LABEL: Record<NetworkRelation['relationType'], string> = {
  membership: 'メンバー',
  production: 'プロデュース',
}

/** Mobile向けのシンプルな関係性リスト(RelationGraphの代替)。 */
export default function ArtistNetworkList({ relations }: { relations: NetworkRelation[] }) {
  if (relations.length === 0) {
    return <p className="mt-4 text-sm text-white/40">登録されている関係性はありません。</p>
  }

  return (
    <ul className="mt-4 divide-y divide-white/5">
      {relations.map((r) => (
        <li key={r.id} className="py-3">
          <Link href={`/artists/${r.otherArtistId}`} className="flex items-center gap-3 hover:opacity-70">
            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-white/5">
              {r.otherArtistImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.otherArtistImageUrl} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{r.otherArtistName}</p>
              <p className="text-xs text-white/40">{RELATION_TYPE_LABEL[r.relationType]}{r.description ? ` · ${r.description}` : ''}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
