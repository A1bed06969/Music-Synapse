import type { NewsItem } from '@/utils/newsParser'
import { formatRelativeTime } from '@/utils/newsParser'

export const NEWS_PREVIEW_COUNT = 8

/** トップページのニュース一覧。データはnews_itemテーブル(utils/newsCache.ts)から
 * 読むだけなので0.2〜0.5秒程度で済み、他のホームカードと並行取得できる
 * (app/page.tsx参照)。以前はSuspenseで別枠にして遅延許容していたが、
 * Suspense境界を通した場合にVercel上で完了までの体感が逆に大幅に悪化する
 * ことが判明した(サーバー側の処理は同じ0.4秒台で終わっているのに、
 * ブラウザでの表示完了が4秒以上かかる。原因はNext.js側のストリーミング
 * 実装とVercelのインフラの組み合わせによるものとみられ、切り分けの結果、
 * 十分速いデータ取得はSuspenseで分離せず素直にawaitした方が速いと判断した)。 */
export default function LatestNewsList({ items }: { items: NewsItem[] }) {
  if (items.length === 0) {
    return <p className="mt-6 text-sm text-white/40">現在ニュースを取得できませんでした。</p>
  }

  return (
    <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
      {items.map((item) => (
        <a key={item.id} href={item.link} target="_blank" rel="noopener noreferrer" className="group block">
          <div className="aspect-video overflow-hidden rounded-md bg-white/5">
            {item.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.thumbnailUrl}
                alt={item.title}
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white/20">No Image</div>
            )}
          </div>
          <p className="mt-2 line-clamp-2 text-sm font-medium group-hover:opacity-70">{item.title}</p>
          <p className="mt-0.5 text-xs text-white/30">
            {item.source} · {formatRelativeTime(item.publishedAt)}
          </p>
        </a>
      ))}
    </div>
  )
}
