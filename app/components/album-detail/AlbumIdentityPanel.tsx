import Link from 'next/link'
import ListenLinks, { type ListenLinkIds } from '@/app/components/detail/ListenLinks'

export type AlbumIdentityData = {
  jacketUrl: string | null
  title: string
  artists: { id: string; name: string }[]
  albumTypeLabel: string | null
  releaseDateLabel: string
  label: { id: string; name: string } | null
  trackCount: number
  format: string | null
  statusLabel: { icon: string; label: string } | null
  listenIds: ListenLinkIds
  extraLinks: { label: string; href: string }[]
  review: string | null
}

/** アルバム詳細ページのLEFTカラム。ジャケット・タイトル・アーティスト・
 * メタ情報・視聴リンク・紹介文をまとめる(トラックページのTrackIdentityPanelと
 * 構成は同じだが、扱うメタ情報の種類が異なるため別コンポーネントにしている)。
 * (docs/superpowers/specs/2026-09-11-album-track-3col-design.md参照) */
export default function AlbumIdentityPanel({ data }: { data: AlbumIdentityData }) {
  return (
    <div className="flex flex-col gap-4">
      <div id="album-header">
        <div className="overflow-hidden rounded-lg bg-white/5">
          {data.jacketUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.jacketUrl} alt={data.title} className="h-auto w-full" />
          ) : (
            <div className="aspect-square w-full" />
          )}
        </div>
        <div className="mt-3">
          <h1 className="text-2xl font-bold leading-tight">{data.title}</h1>
          {data.artists.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-white/60">
              {data.artists.map((a, i) => (
                <span key={a.id} className="flex items-center">
                  <Link href={`/artists/${a.id}`} className="hover:text-white">
                    {a.name}
                  </Link>
                  {i < data.artists.length - 1 && <span className="text-white/40">,</span>}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/45">
        {data.albumTypeLabel && (
          <>
            <span>{data.albumTypeLabel}</span>
            <span>·</span>
          </>
        )}
        <span>{data.releaseDateLabel}</span>
        {data.label && (
          <>
            <span>·</span>
            <Link href={`/labels/${data.label.id}`} className="hover:text-white">
              {data.label.name}
            </Link>
          </>
        )}
        {data.trackCount > 0 && (
          <>
            <span>·</span>
            <span>{data.trackCount}曲</span>
          </>
        )}
        {data.format && (
          <>
            <span>·</span>
            <span>{data.format}</span>
          </>
        )}
        {data.statusLabel && (
          <>
            <span>·</span>
            <span>
              {data.statusLabel.icon} {data.statusLabel.label}
            </span>
          </>
        )}
      </div>

      <ListenLinks kind="album" ids={data.listenIds} extraLinks={data.extraLinks} />

      {data.review && data.review.trim() && (
        <div>
          <h2 className="text-xs uppercase tracking-wide text-white/40">紹介</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/70">{data.review}</p>
        </div>
      )}
    </div>
  )
}
