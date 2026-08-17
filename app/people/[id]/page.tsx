import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { CREDIT_ROLE_LABEL, CREDIT_ROLE_COLOR } from '@/utils/format'

export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: person, error } = await supabase.from('credit_person').select('id, name').eq('id', id).single()

  if (error || !person) {
    notFound()
  }

  const { data: credits } = await supabase
    .from('artist_credit')
    .select('id, role, artist:artist_id(id, name), album:album_id(id, title)')
    .eq('credit_person_id', id)
    .order('role')

  type CreditGroup = {
    artistId: string
    artistName: string
    albumId: string | null
    albumTitle: string | null
    trackCount: number
  }

  // artist_creditは曲単位で保存されているため、同じアルバムの全曲に同じロールで
  // クレジットされていると曲数分だけ行が重複してしまう。(role, アーティスト, アルバム)
  // が同じものは1行にまとめ、曲数を添えて表示する
  const creditsByRole = new Map<string, Map<string, CreditGroup>>()
  for (const c of credits ?? []) {
    const artist = Array.isArray(c.artist) ? c.artist[0] : c.artist
    const album = Array.isArray(c.album) ? c.album[0] : c.album
    if (!artist) continue
    const groupKey = `${artist.id}:${album?.id ?? 'none'}`
    const roleGroups = creditsByRole.get(c.role) ?? new Map<string, CreditGroup>()
    const existing = roleGroups.get(groupKey)
    if (existing) {
      existing.trackCount += 1
    } else {
      roleGroups.set(groupKey, {
        artistId: artist.id,
        artistName: artist.name,
        albumId: album?.id ?? null,
        albumTitle: album?.title ?? null,
        trackCount: 1,
      })
    }
    creditsByRole.set(c.role, roleGroups)
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/search" className="text-xs text-white/40 hover:text-white/70">
        ← 検索に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{person.name}</h1>

      {creditsByRole.size > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {Array.from(creditsByRole.keys()).map((role) => (
            <span
              key={role}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${CREDIT_ROLE_COLOR[role] ?? 'border-white/15 text-white/60'}`}
            >
              {CREDIT_ROLE_LABEL[role] ?? role}
            </span>
          ))}
        </div>
      )}

      {creditsByRole.size === 0 ? (
        <p className="mt-8 text-sm text-white/40">クレジット情報がありません。</p>
      ) : (
        Array.from(creditsByRole.entries()).map(([role, roleGroups]) => (
          <div key={role} className="mt-8">
            <p className="text-xs uppercase tracking-wide text-white/40">{CREDIT_ROLE_LABEL[role] ?? role}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {Array.from(roleGroups.values()).map((item) => (
                <li key={`${item.artistId}:${item.albumId ?? 'none'}`}>
                  <Link href={`/artists/${item.artistId}`} className="hover:text-white/70">
                    {item.artistName}
                  </Link>
                  {item.albumTitle &&
                    (item.albumId ? (
                      <Link href={`/albums/${item.albumId}`} className="text-white/40 hover:text-white/70">
                        {' '}
                        ・ {item.albumTitle}
                      </Link>
                    ) : (
                      <span className="text-white/40"> ・ {item.albumTitle}</span>
                    ))}
                  {item.trackCount > 1 && <span className="text-white/30"> ({item.trackCount}曲)</span>}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  )
}
