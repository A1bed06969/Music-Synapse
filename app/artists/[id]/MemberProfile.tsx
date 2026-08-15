import Link from 'next/link'

type Band = { id: string; name: string; description: string | null }
type Production = { id: number; artistId: string; artistName: string; description: string | null }

export default function MemberProfile({
  name,
  nameKana,
  nameEn,
  imageUrl,
  bio,
  bands,
  productions,
}: {
  name: string
  nameKana: string | null
  nameEn: string | null
  imageUrl: string | null
  bio: string | null
  bands: Band[]
  productions: Production[]
}) {
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/search" className="text-xs text-white/40 hover:text-white/70">
        ← 検索に戻る
      </Link>

      <div className="mt-4 flex items-start gap-6">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={name} className="h-28 w-28 rounded-full object-cover" />
        ) : (
          <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full bg-white/5 text-3xl">
            🎤
          </div>
        )}

        <div>
          <h1 className="text-2xl font-bold">{name}</h1>
          <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-white/50">
            {nameKana && <span>{nameKana}</span>}
            {nameEn && <span>{nameEn}</span>}
          </div>

          {bands.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/60">
              {bands.map((band) => (
                <Link
                  key={band.id}
                  href={`/artists/${band.id}`}
                  className="rounded-full border border-white/15 px-2.5 py-0.5 hover:bg-white/5"
                >
                  🎤 {band.name} のメンバー
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {bio && <p className="mt-6 text-sm leading-relaxed text-white/70">{bio}</p>}

      {productions.length > 0 && (
        <div className="mt-10">
          <h2 className="text-xs uppercase tracking-wide text-white/40">Production & Songwriting</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {productions.map((item) => (
              <li key={item.id}>
                <Link href={`/artists/${item.artistId}`} className="hover:text-white/70">
                  {item.artistName}
                </Link>
                {item.description && <span className="text-white/40"> ・ {item.description}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
