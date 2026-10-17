/** キュレーションコンテンツのメインビジュアル(21:9)。専用のバナー画像があればそれを出す。
 * 画像が無い、または一覧カード用のアイコン(/curation/ 以下の正方形画像)しか無い
 * 企画は、選出された作品のジャケットを均等に間引いて並べたコラージュにする
 * (アイコンを横長枠にそのまま拡大するとぼやけて切れるため)。 */
const COLLAGE_CELLS = 24

export function isIconImage(url: string | null): boolean {
  return !!url && url.startsWith('/curation/')
}

function pickJackets(jackets: (string | null)[]): string[] {
  const unique = Array.from(new Set(jackets.filter((u): u is string => !!u)))
  if (unique.length <= COLLAGE_CELLS) return unique
  const step = unique.length / COLLAGE_CELLS
  return Array.from({ length: COLLAGE_CELLS }, (_, i) => unique[Math.floor(i * step)])
}

export default function CurationVisual({
  imageUrl,
  name,
  jackets,
}: {
  imageUrl: string | null
  name: string
  jackets: (string | null)[]
}) {
  const useBanner = !!imageUrl && !isIconImage(imageUrl)
  const picked = useBanner ? [] : pickJackets(jackets)
  if (!useBanner && picked.length === 0) return null

  return (
    <div className="aspect-[21/9] w-full overflow-hidden rounded-lg bg-white/5">
      {useBanner ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl!} alt={name} className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full grid-cols-8 grid-rows-3">
          {picked.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" className="h-full w-full object-cover" />
          ))}
        </div>
      )}
    </div>
  )
}
