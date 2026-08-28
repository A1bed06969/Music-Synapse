import Link from 'next/link'
import PrefectureMap, { type PrefectureMapData } from './PrefectureMap'
import type { UpcomingAlbumCard, UpcomingFestivalCard, PowerPlayTopEntry } from '@/utils/homeCards'

function formatShortDate(dateStr: string) {
  const [, m, d] = dateStr.split('-')
  return `${Number(m)}/${Number(d)}`
}

function formatDateRange(start: string, end: string) {
  return start === end ? formatShortDate(start) : `${formatShortDate(start)} - ${formatShortDate(end)}`
}

function CardHeader({
  index,
  eyebrow,
  eyebrowHref,
  title,
  subtitle,
  accent,
}: {
  index: string
  eyebrow: string
  eyebrowHref: string
  title: string
  subtitle: string
  accent: string
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <span className="text-xs font-bold tracking-widest" style={{ color: accent }}>
          {index}
        </span>
        <h2 className="mt-1 text-2xl font-bold leading-tight sm:text-3xl">{title}</h2>
        <p className="mt-1 text-sm text-white/50">{subtitle}</p>
      </div>
      <Link
        href={eyebrowHref}
        className="shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium tracking-wide transition hover:bg-white/5"
        style={{ borderColor: `${accent}66`, color: accent }}
      >
        {eyebrow} →
      </Link>
    </div>
  )
}

export function DiscoverNewMusicCard({ albums }: { albums: UpcomingAlbumCard[] }) {
  const accent = '#5b8def'
  return (
    <div
      className="rounded-xl border border-white/10 p-6 sm:p-8"
      style={{ background: 'linear-gradient(135deg, rgba(91,141,239,0.08), rgba(255,255,255,0.02))' }}
    >
      <CardHeader
        index="01"
        eyebrow="NEW RELEASES"
        eyebrowHref="/albums/calendar"
        title="Discover New Music"
        subtitle="今週の新譜ピックアップ"
        accent={accent}
      />
      {albums.length === 0 ? (
        <p className="mt-6 text-sm text-white/30">近日リリース予定の新譜はまだ登録されていません。</p>
      ) : (
        <div className="mt-6 flex gap-4 overflow-x-auto pb-1">
          {albums.map((a) => (
            <Link key={a.id} href={`/albums/${a.id}`} className="group block w-32 shrink-0 sm:w-36">
              <div className="aspect-square overflow-hidden rounded-md bg-white/5">
                {a.jacketUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.jacketUrl}
                    alt={a.title}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-white/20">No Art</div>
                )}
              </div>
              <p className="mt-2 truncate text-sm font-medium group-hover:opacity-70">{a.title}</p>
              <p className="truncate text-xs text-white/40">{a.artistName}</p>
              <p className="text-[11px] text-white/30">{formatShortDate(a.releaseDate)}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export function FesLiveFreakCard({ festivals }: { festivals: UpcomingFestivalCard[] }) {
  const accent = '#4fd1a5'
  return (
    <div
      className="rounded-xl border border-white/10 p-6 sm:p-8"
      style={{ background: 'linear-gradient(135deg, rgba(79,209,165,0.08), rgba(255,255,255,0.02))' }}
    >
      <CardHeader
        index="02"
        eyebrow="FESTIVALS & EVENTS"
        eyebrowHref="/events"
        title="Fes & Live Freak"
        subtitle="国内外のフェス・イベント情報"
        accent={accent}
      />
      {festivals.length === 0 ? (
        <p className="mt-6 text-sm text-white/30">近日開催予定のフェス情報はまだ登録されていません。</p>
      ) : (
        <div className="mt-6 flex gap-4 overflow-x-auto pb-1">
          {festivals.map((f) => (
            <Link key={f.id} href={`/events/${f.id}`} className="group block w-44 shrink-0 sm:w-52">
              <div className="aspect-video overflow-hidden rounded-md bg-white/5">
                {f.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={f.imageUrl}
                    alt={f.name}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-2xl">🎪</div>
                )}
              </div>
              <p className="mt-2 truncate text-sm font-medium group-hover:opacity-70">{f.name}</p>
              <p className="truncate text-xs text-white/40">{f.venue ?? ''}</p>
              <p className="text-[11px] text-white/30">{formatDateRange(f.startDate, f.endDate)}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export function MonthlyNextBreakCard({
  top,
  prefectureData,
  monthLabel,
}: {
  top: PowerPlayTopEntry[]
  prefectureData: PrefectureMapData[]
  monthLabel: string
}) {
  const accent = '#f0975a'
  const [first, ...rest] = top

  return (
    <div
      className="rounded-xl border border-white/10 p-6 sm:p-8"
      style={{ background: 'linear-gradient(135deg, rgba(240,151,90,0.08), rgba(255,255,255,0.02))' }}
    >
      <CardHeader
        index="03"
        eyebrow="RANKING & MAP"
        eyebrowHref="/media/on-air"
        title="Monthly Next Break"
        subtitle="今月のパワープレイ集計ランキング"
        accent={accent}
      />

      {top.length === 0 ? (
        <p className="mt-6 text-sm text-white/30">{monthLabel}のパワープレイ実績はまだありません。</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4 sm:flex-row">
            {first && (
              <Link href={first.href || (first.artistId ? `/artists/${first.artistId}` : '#')} className="group block w-full sm:w-40 shrink-0">
                <div className="aspect-square overflow-hidden rounded-lg bg-white/5">
                  {first.artistImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={first.artistImageUrl}
                      alt={first.label}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-2xl">🏆</div>
                  )}
                </div>
                <p className="mt-2 text-[11px] font-semibold" style={{ color: accent }}>
                  POWER PLAY No.1
                </p>
                <p className="truncate text-sm font-semibold group-hover:opacity-70">{first.sub ?? first.label}</p>
                {first.sub && <p className="truncate text-xs text-white/40">{first.label}</p>}
              </Link>
            )}

            {rest.length > 0 && (
              <ul className="flex-1 space-y-2.5">
                {rest.map((r, i) => (
                  <li key={r.key}>
                    <Link
                      href={r.href || (r.artistId ? `/artists/${r.artistId}` : '#')}
                      className="flex items-center gap-2.5 group"
                    >
                      <span className="w-4 shrink-0 text-right text-sm font-bold text-white/30">{i + 2}</span>
                      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-white/5">
                        {r.artistImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.artistImageUrl} alt="" className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                      <span className="truncate text-sm text-white/70 group-hover:text-white">{r.sub ?? r.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="min-w-0">
            <PrefectureMap data={prefectureData} />
          </div>
        </div>
      )}
    </div>
  )
}
