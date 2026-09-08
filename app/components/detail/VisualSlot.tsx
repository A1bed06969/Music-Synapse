/** 見開きにするか1カラムにするかの判定用。
 * `const visual = <VisualSlot/>` の戻り値はJSX要素なので、
 * コンポーネントが内部でnullを返しても常にtruthyになる。判定は必ずこの関数で行う。 */
export function hasVisualContent({
  review,
  youtubeVideoId,
}: {
  review?: string | null
  youtubeVideoId?: string | null
}): boolean {
  return Boolean((review && review.trim()) || youtubeVideoId)
}

/** 見開きの左カラム。紹介文とMVのどちらかがあれば表示し、どちらも無ければnullを返して
 * 呼び出し側に見開きを解除させる(右カラムが全幅になる)。
 *
 * 当初は紹介文もMVも無いときに大判アートワーク→関連ジャケのモザイクへフォールバックして
 * 空白を埋める設計だったが、本番で見ると、ヘッダーに既に出ているジャケットを真下に
 * 大きく再掲するだけになり意図が伝わらなかった。空けておく方が素直だと判断して外した。 */
export default function VisualSlot({
  review,
  youtubeVideoId,
  title,
  layout = 'spread',
}: {
  review?: string | null
  youtubeVideoId?: string | null
  /** YouTube埋め込みのtitle属性に使う(作品名・曲名) */
  title: string
  /** 'spread': 見開き時の左カラム。呼び出し側が `lg:w-[46%]` などで幅を制約するため、
   *  ここでは上限を持たせない。
   *  'full': 見開き解除時(右カラムが空)。呼び出し側から幅の制約が一切来ないため、
   *  ここで上限を持たせて横に伸びきるのを防ぐ。 */
  layout?: 'spread' | 'full'
}) {
  const hasReview = Boolean(review && review.trim())
  const hasVideo = Boolean(youtubeVideoId)

  if (!hasReview && !hasVideo) return null

  const capClassName = layout === 'full' ? 'max-w-[646px]' : ''

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
              title={title}
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
