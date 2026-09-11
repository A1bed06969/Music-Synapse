// app/components/track-detail/TrackCenterContent.tsx
import Link from 'next/link'
import { formatDuration, CREDIT_ROLE_LABEL } from '@/utils/format'

export type SiblingTrack = { id: string; track_no: number | null; title: string; duration_seconds: number | null }
export type InstrumentGroup = { instrumentId: string; instrumentName: string; people: { id: string; name: string }[] }
export type CreditGroup = { role: string; people: { id: string; name: string }[] }

/** トラック詳細ページのCENTER。MV(あれば先頭)→他の曲→使用楽器→クレジット、
 * の縦積み。アルバムページのCENTERと違いタブは持たない(トラックは単一の
 * MVしか扱わないため切り替えの必要が無い)。
 * (docs/superpowers/specs/2026-09-11-album-track-3col-design.md参照) */
export default function TrackCenterContent({
  youtubeVideoId,
  title,
  album,
  siblingTracks,
  instrumentGroups,
  creditGroups,
}: {
  youtubeVideoId: string | null
  title: string
  album: { id: string; title: string } | null
  siblingTracks: SiblingTrack[]
  instrumentGroups: InstrumentGroup[]
  creditGroups: CreditGroup[]
}) {
  return (
    <div className="flex flex-col gap-10">
      {youtubeVideoId && (
        <div>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">ミュージックビデオ</h2>
          <div className="mt-2 aspect-video overflow-hidden rounded-md bg-black">
            <iframe
              src={`https://www.youtube.com/embed/${youtubeVideoId}`}
              title={title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
              className="h-full w-full"
            />
          </div>
          {/* 権利元が埋め込み表示を無効化している動画は埋め込みプレイヤーが再生できず
           * エラー表示になる(こちらでは検知・回避できない)ため、常にYouTube本体への
           * 逃げ道リンクを添えておく */}
          <a
            href={`https://www.youtube.com/watch?v=${youtubeVideoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-block text-[11px] text-white/40 hover:text-white/70"
          >
            再生できない場合はYouTubeで見る ↗
          </a>
        </div>
      )}

      {siblingTracks.length > 0 && album && (
        <section>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">{album.title}の他の曲</h2>
          <ol className="mt-3 divide-y divide-white/10">
            {siblingTracks.map((t) => (
              <li key={t.id}>
                <Link href={`/tracks/${t.id}`} className="flex items-center gap-4 py-2.5 text-sm hover:opacity-70">
                  <span className="w-5 shrink-0 text-right text-white/30">{t.track_no ?? '-'}</span>
                  <span className="flex-1 truncate">{t.title}</span>
                  <span className="text-white/30">{formatDuration(t.duration_seconds)}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {instrumentGroups.length > 0 && (
        <section>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">使用楽器</h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            {instrumentGroups.map((group) => (
              <li key={group.instrumentId} className="flex flex-wrap items-baseline gap-x-2 text-white/70">
                <Link href={`/tracks/instrument/${group.instrumentId}`} className="text-white/40 hover:text-white">
                  {group.instrumentName}
                </Link>
                {group.people.length > 0 && (
                  <span>
                    {group.people.map((person, i) => (
                      <span key={person.id}>
                        {i > 0 && '、'}
                        <Link href={`/people/${person.id}`} className="hover:text-white">
                          {person.name}
                        </Link>
                      </span>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {creditGroups.length > 0 && (
        <details className="border-t border-white/10 pt-6">
          <summary className="cursor-pointer text-white/35 hover:text-white/60">
            <h2 className="inline text-[11px] font-medium uppercase tracking-[0.14em]">
              クレジット({creditGroups.reduce((total, g) => total + g.people.length, 0)}件)
            </h2>
          </summary>
          <ul className="mt-3 space-y-1.5 text-sm">
            {creditGroups.map((group) => (
              <li key={group.role} className="flex flex-wrap items-baseline gap-x-2 text-white/70">
                <span className="text-white/40">{CREDIT_ROLE_LABEL[group.role] ?? group.role}</span>
                <span>
                  {group.people.map((person, i) => (
                    <span key={person.id}>
                      {i > 0 && '、'}
                      <Link href={`/people/${person.id}`} className="hover:text-white">
                        {person.name}
                      </Link>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
