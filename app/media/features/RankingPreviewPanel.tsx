import Link from 'next/link'
import { type RankingPreview, type RankingPreviewEntry } from './actions'

function yearOf(entry: RankingPreviewEntry): string {
  return entry.periodDate ? entry.periodDate.slice(0, 4) : '年度不明'
}

/** period_dateの年でエントリをグルーピングし、年の新しい順に並べる。 */
function groupByYear(entries: RankingPreviewEntry[]): Array<[string, RankingPreviewEntry[]]> {
  const groups = new Map<string, RankingPreviewEntry[]>()
  for (const entry of entries) {
    const year = yearOf(entry)
    const bucket = groups.get(year)
    if (bucket) bucket.push(entry)
    else groups.set(year, [entry])
  }
  return Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a))
}

function TileGrid({ entries }: { entries: RankingPreviewEntry[] }) {
  return (
    <ul className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
      {entries.map((entry) => {
        const content = (
          <>
            <div className={`aspect-square overflow-hidden bg-white/5 ${entry.isArtistOnly ? 'rounded-full' : 'rounded-md'}`}>
              {entry.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={entry.imageUrl} alt={entry.label} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-lg">
                  {entry.isArtistOnly ? '🎤' : '💿'}
                </div>
              )}
            </div>
            <p className="mt-1.5 truncate text-xs font-medium">{entry.label}</p>
            {entry.sub && <p className="truncate text-[10px] text-white/40">{entry.sub}</p>}
          </>
        )
        return (
          <li key={entry.id}>
            {entry.href ? (
              <Link href={entry.href} className="group block hover:opacity-80">
                {content}
              </Link>
            ) : (
              content
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** キュレーションコンテンツ1件のエントリ一覧(中央カラム)。selection型は
 * 年度ごとに区切ったジャケット中心のタイルグリッド(/media/features/[id]の
 * 年度区切りと同じ見出しスタイルを踏襲、全件表示)、ranking型は順位付きリストで
 * 表示する。タイトル・メインビジュアルはRankingPreviewHeader(左カラム)側が担当する。 */
export default function RankingPreviewPanel({ preview }: { preview: RankingPreview }) {
  const isSelection = preview.listType === 'selection'
  const yearGroups = isSelection ? groupByYear(preview.entries) : []

  if (preview.entries.length === 0) {
    return (
      <p className="text-sm text-white/40">
        {isSelection ? 'まだ選出されたコンテンツが登録されていません。' : 'まだランクインしたコンテンツが登録されていません。'}
      </p>
    )
  }

  if (!isSelection) {
    return (
      <ol className="divide-y divide-white/5">
        {preview.entries.map((entry) => (
          <li key={entry.id} className="flex items-center gap-3 py-2.5">
            <span className="w-6 shrink-0 text-right text-sm font-bold text-white/30">{entry.rank}</span>
            <div className="min-w-0 flex-1">
              {entry.href ? (
                <Link href={entry.href} className="truncate text-sm font-medium hover:opacity-70">
                  {entry.label}
                </Link>
              ) : (
                <span className="truncate text-sm font-medium">{entry.label}</span>
              )}
              {entry.sub && <span className="ml-2 text-xs text-white/40">{entry.sub}</span>}
            </div>
            {entry.metricValue != null && (
              <span className="shrink-0 text-xs text-white/40">
                {entry.metricValue}
                {entry.metricLabel ? ` ${entry.metricLabel}` : ''}
              </span>
            )}
          </li>
        ))}
      </ol>
    )
  }

  return (
    <div>
      {yearGroups.map(([year, entries], i) => (
        <section key={year} className={i === 0 ? '' : 'mt-14'}>
          <div className="flex items-center gap-4">
            <h3 className="text-2xl font-bold text-white">
              {year}
              {year !== '年度不明' && <span className="ml-1 text-sm font-medium text-white/40">年</span>}
            </h3>
            <span className="h-px flex-1 bg-white/15" />
            <span className="shrink-0 text-xs text-white/30">{entries.length}件</span>
          </div>
          <div className="mt-6">
            <TileGrid entries={entries} />
          </div>
        </section>
      ))}
    </div>
  )
}
