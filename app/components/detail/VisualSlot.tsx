import Link from 'next/link'

type MosaicItem = { id: string; href: string; imageUrl: string | null; title: string }

/** 見開きにするか1カラムにするかの判定用。
 * `const visual = <VisualSlot/>` の戻り値はJSX要素なので、
 * コンポーネントが内部でnullを返しても常にtruthyになる。判定は必ずこの関数で行う。 */
export function hasVisualContent({
  review,
  youtubeVideoId,
  imageUrl,
  mosaicCount = 0,
}: {
  review?: string | null
  youtubeVideoId?: string | null
  imageUrl?: string | null
  mosaicCount?: number
}): boolean {
  return Boolean((review && review.trim()) || youtubeVideoId || imageUrl || mosaicCount > 0)
}

/** 見開きの左カラム。紹介文がほぼ存在しない(album_review 0件 / artist.bio 4件)ため、
 * テキストが無いときは図版で埋める。優先順は
 * 紹介文 → MV → 大判アートワーク → 関連ジャケのモザイク。
 * どれも無ければnullを返し、呼び出し側が見開きを解除する。 */
export default function VisualSlot({
  review,
  youtubeVideoId,
  imageUrl,
  imageAlt,
  imageShape = 'square',
  mosaic = [],
  layout = 'spread',
}: {
  review?: string | null
  youtubeVideoId?: string | null
  imageUrl?: string | null
  imageAlt: string
  imageShape?: 'square' | 'circle'
  mosaic?: MosaicItem[]
  /** 'spread': 見開き時の左カラム。呼び出し側が `lg:w-[46%]` などで幅を制約するため、
   *  ここでは上限を持たせない。
   *  'full': 見開き解除時(右カラムが空)。呼び出し側から幅の制約が一切来ないため、
   *  ここで上限を持たせる。646pxは見開き時の左カラム実測値(1440px viewport)に
   *  揃えた値で、大判アートワークが全幅(最大1552px)に広がるのを防ぐ。 */
  layout?: 'spread' | 'full'
}) {
  const hasReview = Boolean(review && review.trim())
  const hasVideo = Boolean(youtubeVideoId)

  const capClassName = layout === 'full' ? 'max-w-[646px]' : ''

  if (hasReview || hasVideo) {
    return (
      <div className={`space-y-6 ${capClassName}`}>
        {hasReview && (
          <div>
            <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">紹介</h2>
            <p className="mt-2 max-w-prose whitespace-pre-wrap text-sm leading-relaxed text-white/75">{review}</p>
          </div>
        )}
        {hasVideo && (
          <div>
            <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
              ミュージックビデオ
            </h2>
            <div className="mt-2 aspect-video overflow-hidden rounded-md bg-black">
              <iframe
                src={`https://www.youtube.com/embed/${youtubeVideoId}`}
                title={imageAlt}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
                className="h-full w-full"
              />
            </div>
          </div>
        )}
      </div>
    )
  }

  if (imageUrl) {
    return (
      <div className={capClassName}>
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">アートワーク</h2>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={imageAlt}
          className={`mt-2 aspect-square w-full object-cover ${
            imageShape === 'circle' ? 'rounded-full' : 'rounded-md'
          }`}
        />
      </div>
    )
  }

  if (mosaic.length > 0) {
    return (
      <div className={capClassName}>
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">関連作品</h2>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {mosaic.slice(0, 9).map((item) => (
            <Link key={item.id} href={item.href} className="group block">
              <div className="aspect-square overflow-hidden rounded-md bg-white/5">
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt={item.title}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-white/20">
                    No Art
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    )
  }

  return null
}
