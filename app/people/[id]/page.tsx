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

  const creditsByRole = new Map<
    string,
    { id: string; artistId: string; artistName: string; albumTitle: string | null }[]
  >()
  for (const c of credits ?? []) {
    const artist = Array.isArray(c.artist) ? c.artist[0] : c.artist
    const album = Array.isArray(c.album) ? c.album[0] : c.album
    if (!artist) continue
    const list = creditsByRole.get(c.role) ?? []
    list.push({ id: c.id, artistId: artist.id, artistName: artist.name, albumTitle: album?.title ?? null })
    creditsByRole.set(c.role, list)
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
        Array.from(creditsByRole.entries()).map(([role, items]) => (
          <div key={role} className="mt-8">
            <p className="text-xs uppercase tracking-wide text-white/40">{CREDIT_ROLE_LABEL[role] ?? role}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {items.map((item) => (
                <li key={item.id}>
                  <Link href={`/artists/${item.artistId}`} className="hover:text-white/70">
                    {item.artistName}
                  </Link>
                  {item.albumTitle && <span className="text-white/40"> ・ {item.albumTitle}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  )
}
