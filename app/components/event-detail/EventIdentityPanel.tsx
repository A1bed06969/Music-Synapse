import { extractYoutubeVideoId } from '@/utils/format'

export type EventIdentityData = {
  name: string
  eventTypeLabel: string | null
  foundedYear: number | null
  country: string | null
  prefecture: string | null
  description: string | null
  imageUrl: string | null
  youtubeUrl: string | null
  officialSiteUrl: string | null
}

/** イベントの画像を、出典(公式サイト or 公式YouTube)へのリンク付きで表示する。
 * 著作権的に問題が起きにくいよう、画像は必ずその出典元へ戻れる形にする。
 * image_urlが無い場合はofficial_youtube_url(動画URL)からサムネイルを導出する
 * フォールバックも用意している(動画しか無いイベント向け)。
 * official_site_urlがあれば、画像とは別に小さな公式サイトリンクも添える。
 * どちらも無ければプレースホルダーを出す */
function EventThumbnail({
  imageUrl,
  youtubeUrl,
  officialSiteUrl,
  eventName,
}: {
  imageUrl: string | null
  youtubeUrl: string | null
  officialSiteUrl: string | null
  eventName: string
}) {
  // image_urlが未設定なら、動画URLからサムネイルを導出するフォールバック
  const videoId = !imageUrl && youtubeUrl ? extractYoutubeVideoId(youtubeUrl) : null
  const displayImageUrl = imageUrl ?? (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null)
  // 画像のリンク先は、その画像の出典元(YouTubeチャンネル/動画があればそちら、
  // 無ければ公式サイト)にする。出典と違う場所へリンクすると「引用」の理屈が弱くなるため
  const imageLinkUrl = youtubeUrl ?? officialSiteUrl
  const sourceLabel = videoId || youtubeUrl ? '公式YouTubeより' : '公式サイトより'

  if (!displayImageUrl) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.01]">
        <span className="text-6xl">🎪</span>
      </div>
    )
  }

  return (
    <div className="w-full">
      <a
        href={imageLinkUrl ?? displayImageUrl}
        target="_blank"
        rel="noreferrer"
        className="group relative block aspect-video overflow-hidden rounded-lg border border-white/10 bg-black"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={displayImageUrl}
          alt={eventName}
          className="h-full w-full object-contain transition group-hover:opacity-80"
        />
        {videoId && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 transition group-hover:bg-black/75">
              <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5 fill-white">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        )}
        <span className="absolute bottom-1.5 right-2 text-[10px] text-white/70">{sourceLabel}</span>
      </a>
      {officialSiteUrl && (
        <a
          href={officialSiteUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 block text-center text-xs text-white/40 hover:text-white/70"
        >
          公式サイトへ →
        </a>
      )}
    </div>
  )
}

/** イベント詳細ページのLEFTカラム。サムネイル・タイトル・種別/設立年・
 * 国/都道府県・紹介文をまとめる(アルバム/トラックページのIdentityPanelと
 * 構成を揃える)。 */
export default function EventIdentityPanel({ data }: { data: EventIdentityData }) {
  return (
    <div className="flex flex-col gap-4">
      <div id="event-header">
        <EventThumbnail
          imageUrl={data.imageUrl}
          youtubeUrl={data.youtubeUrl}
          officialSiteUrl={data.officialSiteUrl}
          eventName={data.name}
        />
        <div className="mt-3">
          <p className="text-xs text-white/40">
            {data.eventTypeLabel}
            {data.foundedYear ? `${data.eventTypeLabel ? ' · ' : ''}${data.foundedYear}年〜` : ''}
          </p>
          <h1 className="mt-1 text-2xl font-bold leading-tight">{data.name}</h1>
          {(data.country || data.prefecture) && (
            <p className="mt-1 text-sm text-white/50">{[data.country, data.prefecture].filter(Boolean).join(' / ')}</p>
          )}
        </div>
      </div>

      {data.description && <p className="text-sm leading-relaxed text-white/70">{data.description}</p>}
    </div>
  )
}
