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
    .select(
      'id, role, artist:artist_id(id, name), album:album_id(id, title), track:track_id(id, title, track_no)'
    )
    .eq('credit_person_id', id)
    .order('role')

  type CreditTrack = { id: string; title: string; trackNo: number | null }
  type CreditGroup = {
    artistId: string
    artistName: string
    albumId: string | null
    albumTitle: string | null
    tracks: CreditTrack[]
  }

  // artist_creditは曲単位で保存されているため、同じアルバムの全曲に同じロールで
  // クレジットされていると曲数分だけ行が重複してしまう。(role, アーティスト, アルバム)
  // が同じものは1行にまとめ、担当した曲の一覧は展開して確認できるようにする
  const creditsByRole = new Map<string, Map<string, CreditGroup>>()
  for (const c of credits ?? []) {
    const artist = Array.isArray(c.artist) ? c.artist[0] : c.artist
    const album = Array.isArray(c.album) ? c.album[0] : c.album
    const track = Array.isArray(c.track) ? c.track[0] : c.track
    if (!artist) continue
    const groupKey = `${artist.id}:${album?.id ?? 'none'}`
    const roleGroups = creditsByRole.get(c.role) ?? new Map<string, CreditGroup>()
    const existing = roleGroups.get(groupKey)
    const trackEntry: CreditTrack | null = track ? { id: track.id, title: track.title, trackNo: track.track_no } : null
    if (existing) {
      if (trackEntry) existing.tracks.push(trackEntry)
    } else {
      roleGroups.set(groupKey, {
        artistId: artist.id,
        artistName: artist.name,
        albumId: album?.id ?? null,
        albumTitle: album?.title ?? null,
        tracks: trackEntry ? [trackEntry] : [],
      })
    }
    creditsByRole.set(c.role, roleGroups)
  }
  for (const roleGroups of creditsByRole.values()) {
    for (const group of roleGroups.values()) {
      group.tracks.sort((a, b) => (a.trackNo ?? 0) - (b.trackNo ?? 0))
    }
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

            <div className="mt-3 flex gap-4 border-b border-white/10 pb-1.5 text-xs uppercase tracking-wide text-white/30">
              <span className="w-40 shrink-0 sm:w-56">アーティスト</span>
              <span>アルバム</span>
            </div>

            <ul className="divide-y divide-white/5 text-sm">
              {Array.from(roleGroups.values()).map((item) => (
                <li key={`${item.artistId}:${item.albumId ?? 'none'}`} className="py-2.5">
                  {item.tracks.length > 0 ? (
                    <details className="group">
                      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-4 marker:content-['']">
                        <span className="w-40 shrink-0 sm:w-56">
                          <Link href={`/artists/${item.artistId}`} className="hover:text-white/70">
                            {item.artistName}
                          </Link>
                        </span>
                        <span className="text-white/60">
                          {item.albumId ? (
                            <Link href={`/albums/${item.albumId}`} className="hover:text-white/85">
                              {item.albumTitle}
                            </Link>
                          ) : (
                            item.albumTitle
                          )}
                          <span className="ml-1.5 text-xs text-white/30">
                            {item.tracks.length > 1 ? `(${item.tracks.length}曲) ▸` : '▸'}
                          </span>
                        </span>
                      </summary>
                      <ul className="mt-2 ml-40 space-y-1 text-xs text-white/50 sm:ml-56">
                        {item.tracks.map((t) => (
                          <li key={t.id}>
                            <Link href={`/tracks/${t.id}`} className="hover:text-white/80">
                              {t.trackNo ? `${t.trackNo}. ` : ''}
                              {t.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    <div className="flex flex-wrap items-center gap-4">
                      <span className="w-40 shrink-0 sm:w-56">
                        <Link href={`/artists/${item.artistId}`} className="hover:text-white/70">
                          {item.artistName}
                        </Link>
                      </span>
                      <span className="text-white/60">
                        {item.albumId ? (
                          <Link href={`/albums/${item.albumId}`} className="hover:text-white/85">
                            {item.albumTitle}
                          </Link>
                        ) : (
                          item.albumTitle
                        )}
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  )
}
