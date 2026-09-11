'use client'

import { useState } from 'react'
import { siApplemusic, siSpotify, siX, siInstagram } from 'simple-icons'
import { getServiceIcon, getFaviconUrl, type ServiceIcon } from '@/utils/serviceIcons'
import { getLinkLabel } from '@/utils/musicbrainz'
import ServiceLinkPill from '@/app/components/ServiceLinkPill'

const MAX_VISIBLE = 4

export type ArtistLinkIconsProps = {
  artistName: string
  officialSiteUrl: string | null
  snsXUrl: string | null
  snsInstagramUrl: string | null
  appleMusicArtistId: string | null
  spotifyArtistId: string | null
  externalLinks: { id: string; link_type: string; url: string }[]
}

type LinkItem = {
  key: string
  icon: ServiceIcon | null
  href: string
  label: string
}

const LISTEN_TYPES = new Set(['streaming', 'free streaming', 'youtube', 'youtube music'])
const SOCIAL_TYPE = 'social network'

/**
 * 同じサービスを指す重複リンクを除外する。ホスト名(大文字小文字を無視)
 * が同じ場合は同一サービスとみなし、先に追加された方(専用カラム由来。
 * 専用カラムのアイテムはexternalLinksループより前にpushされる)を残す。
 * Apple Musicのようにリージョン違いのパス(/jp/artist/... と
 * /gb/artist/...)がartist_external_linkに複数登録されるケースがあるため、
 * パスは無視してホスト名のみで判定する。URLとして不正な場合は生の文字列
 * をそのままキーとして使う(パースエラーで例外を投げない)。
 */
function dedupeByUrl(items: LinkItem[]): LinkItem[] {
  const seen = new Set<string>()
  const result: LinkItem[] = []
  for (const item of items) {
    let key: string
    try {
      key = new URL(item.href).hostname.toLowerCase()
    } catch {
      key = item.href
    }
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

/** 4件までは折り返さず1行で表示し、それを超える分は「もっと見る」から
 * モーダルで全件表示する(LEFTカラムの限られた横幅で改行させないため)。 */
function CategoryRow({ label, items }: { label: string; items: LinkItem[] }) {
  const [showAll, setShowAll] = useState(false)
  if (items.length === 0) return null

  const visibleItems = items.slice(0, MAX_VISIBLE)
  const hiddenCount = items.length - visibleItems.length

  return (
    <div className="mt-3">
      <p className="text-xs uppercase tracking-wide text-white/40">{label}</p>
      {/* overflow-x-auto: 4件でも幅の狭いモバイルでは収まりきらないことがあるため、
       * overflow-hiddenで無言のまま切り詰めず横スクロールで到達可能にしておく。 */}
      <div className="mt-2 flex flex-nowrap gap-2 overflow-x-auto">
        {visibleItems.map((item) => (
          <ServiceLinkPill
            key={item.key}
            href={item.href}
            label={item.label}
            icon={item.icon}
            faviconUrl={item.icon ? null : getFaviconUrl(item.href)}
          />
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="shrink-0 rounded-full border border-white/15 px-3 py-1 text-xs text-white/60 transition hover:text-white"
          >
            +{hiddenCount}
          </button>
        )}
      </div>

      {showAll && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setShowAll(false)}
        >
          <div
            className="relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border border-white/10 bg-[#1a1a1a]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[#1a1a1a] px-6 py-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-white/60">{label}</h3>
              <button
                type="button"
                onClick={() => setShowAll(false)}
                className="text-2xl leading-none text-white/40 hover:text-white/80"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>
            <div className="flex flex-wrap gap-2 px-6 py-4">
              {items.map((item) => (
                <ServiceLinkPill
                  key={item.key}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  faviconUrl={item.icon ? null : getFaviconUrl(item.href)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ArtistLinkIcons({
  artistName,
  officialSiteUrl,
  snsXUrl,
  snsInstagramUrl,
  appleMusicArtistId,
  spotifyArtistId,
  externalLinks,
}: ArtistLinkIconsProps) {
  const listenItems: LinkItem[] = []
  if (appleMusicArtistId) {
    listenItems.push({
      key: 'apple-music',
      icon: siApplemusic,
      href: `https://music.apple.com/jp/artist/${encodeURIComponent(artistName)}/${appleMusicArtistId}`,
      label: 'Apple Music',
    })
  }
  if (spotifyArtistId) {
    listenItems.push({
      key: 'spotify',
      icon: siSpotify,
      href: `https://open.spotify.com/artist/${spotifyArtistId}`,
      label: 'Spotify',
    })
  }
  // ブランドアイコンが無い(=マイナーで見分けが付かない)サービスは、主要な
  // サブスク・SNSに絞るという方針上ここでは表示しない(getServiceIconが
  // nullを返すもの)。公式サイトはブランドアイコンを持たないが例外的に残す。
  for (const link of externalLinks) {
    if (!LISTEN_TYPES.has(link.link_type)) continue
    const icon = getServiceIcon(link.url)
    if (!icon) continue
    listenItems.push({
      key: link.id,
      icon,
      href: link.url,
      label: getLinkLabel(link.url, link.link_type),
    })
  }

  const officialSnsItems: LinkItem[] = []
  if (officialSiteUrl) {
    officialSnsItems.push({ key: 'official', icon: null, href: officialSiteUrl, label: '公式サイト' })
  }
  if (snsXUrl) {
    officialSnsItems.push({ key: 'x', icon: siX, href: snsXUrl, label: 'X' })
  }
  if (snsInstagramUrl) {
    officialSnsItems.push({ key: 'instagram', icon: siInstagram, href: snsInstagramUrl, label: 'Instagram' })
  }
  for (const link of externalLinks) {
    if (link.link_type !== SOCIAL_TYPE) continue
    const icon = getServiceIcon(link.url)
    if (!icon) continue
    officialSnsItems.push({
      key: link.id,
      icon,
      href: link.url,
      label: getLinkLabel(link.url, link.link_type),
    })
  }

  if (listenItems.length === 0 && officialSnsItems.length === 0) {
    return null
  }

  return (
    <div>
      <CategoryRow label="視聴" items={dedupeByUrl(listenItems)} />
      <CategoryRow label="公式・SNS" items={dedupeByUrl(officialSnsItems)} />
    </div>
  )
}
