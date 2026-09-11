import Link from 'next/link'
import ListenLinks, { type ListenLinkIds } from '@/app/components/detail/ListenLinks'
import PreviewButton from '@/app/components/PreviewButton'

export type TrackIdentityData = {
  id: string
  jacketUrl: string | null
  title: string
  artists: { id: string; name: string }[]
  album: { id: string; title: string } | null
  durationLabel: string
  previewUrl: string | null
  listenIds: ListenLinkIds
  extraLinks: { label: string; href: string }[]
  review: string | null
}

/** トラック詳細ページのLEFTカラム。ジャケットはアルバム経由(トラック自体は
 * ジャケットを持たない、既存動作を踏襲)。試聴の大ボタン(PreviewButton size="lg")は
 * 従来DetailHeaderのactionsでListenLinksと並んでいたのをそのままこちらに移設する。
 * (docs/superpowers/specs/2026-09-11-album-track-3col-design.md参照) */
export default function TrackIdentityPanel({ data }: { data: TrackIdentityData }) {
  return (
    <div className="flex flex-col gap-4">
      <div id="track-header">
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

      <div className="flex flex-wrap items-center gap-x-2 text-xs text-white/45">
        {data.album && (
          <>
            <Link href={`/albums/${data.album.id}`} className="hover:text-white">
              {data.album.title}
            </Link>
            <span>·</span>
          </>
        )}
        <span>{data.durationLabel}</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <PreviewButton previewUrl={data.previewUrl} trackId={data.id} size="lg" />
        <ListenLinks kind="track" ids={data.listenIds} extraLinks={data.extraLinks} />
      </div>

      {data.review && data.review.trim() && (
        <div>
          <h2 className="text-xs uppercase tracking-wide text-white/40">紹介</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/70">{data.review}</p>
        </div>
      )}
    </div>
  )
}
