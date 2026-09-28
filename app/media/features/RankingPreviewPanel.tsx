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

/** rankを100件区切り(1-100, 101-200, ...)でグルーピングする。entriesは既に
 * rank昇順で渡される前提(呼び出し元のgetRankingPreviewがorder済み)なので、
 * Mapの挿入順=表示順のままでよい。 */
function groupByHundred(entries: RankingPreviewEntry[]): Array<[string, RankingPreviewEntry[]]> {
  const groups = new Map<string, RankingPreviewEntry[]>()
  for (const entry of entries) {
    const rank = entry.rank ?? 0
    const bucketStart = Math.floor((rank - 1) / 100) * 100 + 1
    const key = `${bucketStart}-${bucketStart + 99}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(entry)
    else groups.set(key, [entry])
  }
  return Array.from(groups.entries())
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

/** 順位付きリストの1行。ジャケット付き。Top10だけ一回り大きく・金文字にして
 * 目立たせる(2026-09-27、ユーザー要望)。 */
function RankedRow({ entry }: { entry: RankingPreviewEntry }) {
  const isTop10 = (entry.rank ?? Infinity) <= 10

  const content = (
    <>
      <span
        className={`shrink-0 text-right font-bold tabular-nums ${
          isTop10 ? 'w-9 text-2xl text-amber-300' : 'w-6 text-sm text-white/30'
        }`}
      >
        {entry.rank}
      </span>
      <div
        className={`shrink-0 overflow-hidden rounded-md bg-white/5 ${isTop10 ? 'h-14 w-14' : 'h-9 w-9'}`}
      >
        {entry.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={entry.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-white/20">💿</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`truncate ${isTop10 ? 'text-base font-semibold' : 'text-sm font-medium'}`}>{entry.label}</p>
        {entry.sub && <p className="truncate text-xs text-white/40">{entry.sub}</p>}
      </div>
      {entry.metricValue != null && (
        <span className="shrink-0 text-xs text-white/40">
          {entry.metricValue}
          {entry.metricLabel ? ` ${entry.metricLabel}` : ''}
        </span>
      )}
    </>
  )

  return (
    <li className={`flex items-center gap-3 ${isTop10 ? 'py-2.5' : 'py-2'}`}>
      {entry.href ? (
        <Link href={entry.href} className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-70">
          {content}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{content}</div>
      )}
    </li>
  )
}

function RankedList({ entries }: { entries: RankingPreviewEntry[] }) {
  const groups = groupByHundred(entries)
  return (
    <div>
      {groups.map(([label, group], i) => (
        <section key={label} className={i === 0 ? '' : 'mt-14'}>
          <div className="flex items-center gap-4">
            <h3 className="text-2xl font-bold text-white">{label}</h3>
            <span className="h-px flex-1 bg-white/15" />
            <span className="shrink-0 text-xs text-white/30">{group.length}件</span>
          </div>
          <ol className="mt-4 divide-y divide-white/5">
            {group.map((entry) => (
              <RankedRow key={entry.id} entry={entry} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

/** キュレーションコンテンツ1件のエントリ一覧(中央カラム)。selection型は
 * 年度ごとに区切ったジャケット中心のタイルグリッド(/media/features/[id]の
 * 年度区切りと同じ見出しスタイルを踏襲、全件表示)、ranking型は100件区切り+
 * ジャケット付きの順位リスト(Top10は強調表示)で表示する。タイトル・
 * メインビジュアルはRankingPreviewHeader(左カラム)側が担当する。 */
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
    return <RankedList entries={preview.entries} />
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
