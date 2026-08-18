import Link from 'next/link'
import type { ArtistCreditQuadrants, QuadrantArtist, QuadrantPerson } from '@/utils/relationGraphData'

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?'
}

function PersonRow({ person }: { person: QuadrantPerson }) {
  return (
    <Link
      href={`/people/${person.id}`}
      className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-white/5"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-xs font-bold text-white/60">
        {initial(person.name)}
      </span>
      <span className="min-w-0 flex-1 truncate">{person.name}</span>
      {person.roleLabels && person.roleLabels.length > 0 && (
        <span className="flex shrink-0 flex-wrap justify-end gap-1">
          {person.roleLabels.map((label) => (
            <span
              key={label}
              className="rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] text-white/40"
            >
              {label}
            </span>
          ))}
        </span>
      )}
    </Link>
  )
}

function ArtistRow({ artist }: { artist: QuadrantArtist }) {
  return (
    <Link
      href={`/artists/${artist.id}`}
      className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-white/5"
    >
      {artist.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={artist.imageUrl} alt={artist.name} className="h-8 w-8 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-xs font-bold text-white/60">
          {initial(artist.name)}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{artist.name}</span>
    </Link>
  )
}

function Quadrant({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-64 flex-col p-4">
      <p className="shrink-0 text-center text-xs font-semibold uppercase tracking-wide text-white/50">{title}</p>
      <div className="mt-3 flex-1 space-y-0.5 overflow-y-auto">{children}</div>
    </div>
  )
}

function EmptyNote() {
  return <p className="pt-6 text-center text-xs text-white/30">登録なし</p>
}

function CenterAvatar({ name, imageUrl }: { name: string; imageUrl: string | null }) {
  return (
    <div className="flex flex-col items-center">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={name}
          className="h-16 w-16 rounded-full border-2 border-white object-cover shadow-lg sm:h-20 sm:w-20"
        />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-white bg-white/10 text-2xl shadow-lg sm:h-20 sm:w-20">
          🎤
        </div>
      )}
      <p className="mt-1 max-w-[7rem] truncate text-center text-xs font-bold text-white">{name}</p>
    </div>
  )
}

/** アーティスト詳細ページ専用の相関図。中心にアーティスト本人、周囲を
 * プロデューサー/制作陣/コラボアーティスト/サポートミュージシャンの
 * 4象限に分けて表示する。ノード間を線で結ぶネットワーク図ではなく
 * カテゴリ別の一覧なので、総合音楽相関図(/relations)のEgoTree/
 * ColumnLayoutとは別実装。 */
export default function ArtistCreditQuadrantGraph({
  centerName,
  centerImageUrl,
  quadrants,
}: {
  centerName: string
  centerImageUrl: string | null
  quadrants: ArtistCreditQuadrants
}) {
  return (
    <div className="w-full">
      <div className="flex justify-center border-b border-white/10 pb-4 sm:hidden">
        <CenterAvatar name={centerName} imageUrl={centerImageUrl} />
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 hidden border-t border-white/10 sm:block" />
        <div className="pointer-events-none absolute inset-y-0 left-1/2 hidden border-l border-white/10 sm:block" />
        <div className="grid grid-cols-1 divide-y divide-white/10 sm:grid-cols-2 sm:divide-y-0">
          <Quadrant title="プロデューサー">
            {quadrants.producers.length === 0 ? (
              <EmptyNote />
            ) : (
              quadrants.producers.map((p) => <PersonRow key={p.id} person={p} />)
            )}
          </Quadrant>
          <Quadrant title="作詞・作曲・編曲・ミックス・マスタリング・アートワーク">
            {quadrants.credits.length === 0 ? (
              <EmptyNote />
            ) : (
              quadrants.credits.map((p) => <PersonRow key={p.id} person={p} />)
            )}
          </Quadrant>
          <Quadrant title="コラボアーティスト">
            {quadrants.collaborators.length === 0 ? (
              <EmptyNote />
            ) : (
              quadrants.collaborators.map((a) => <ArtistRow key={a.id} artist={a} />)
            )}
          </Quadrant>
          <Quadrant title="サポートミュージシャン">
            {quadrants.musicians.length === 0 ? (
              <EmptyNote />
            ) : (
              quadrants.musicians.map((p) => <PersonRow key={p.id} person={p} />)
            )}
          </Quadrant>
        </div>
        <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 sm:flex">
          <CenterAvatar name={centerName} imageUrl={centerImageUrl} />
        </div>
      </div>
    </div>
  )
}
