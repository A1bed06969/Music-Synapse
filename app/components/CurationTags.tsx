import Link from 'next/link'
import { getCurationFaviconUrl } from '@/utils/curationSource'

export type CurationRanking = { id: string; name: string; source: string | null }

/** アーティスト/アルバム/トラック各詳細ページ共通の「選出済み」タグ。
 * 企画の運営元サイトのファビコンをアイコンとして使い、取得できない場合は
 * 🏆にフォールバックする。 */
export default function CurationTags({ rankings }: { rankings: CurationRanking[] }) {
  if (rankings.length === 0) return null

  return (
    <>
      {rankings.map((ranking) => {
        const faviconUrl = getCurationFaviconUrl(ranking.source)
        return (
          <Link
            key={ranking.id}
            href={`/media/features/${ranking.id}`}
            className="flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 text-amber-300 hover:bg-amber-400/20"
          >
            {faviconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={faviconUrl} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm" />
            ) : (
              <span>🏆</span>
            )}
            {ranking.name}選出
          </Link>
        )
      })}
    </>
  )
}
