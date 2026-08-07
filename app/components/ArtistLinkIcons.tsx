import { siApplemusic, siSpotify, siX, siInstagram } from 'simple-icons'
import { getServiceIcon, GENERIC_LINK_ICON_PATH, type ServiceIcon } from '@/utils/serviceIcons'
import { getLinkLabel } from '@/utils/musicbrainz'

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
const INFO_TYPES = new Set(['other databases', 'allmusic', 'discogs', 'wikidata', 'IMDb'])

function IconBadge({ item }: { item: LinkItem }) {
  if (item.icon) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noreferrer"
        title={item.label}
        aria-label={item.label}
        className="flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-80"
        style={{ backgroundColor: `#${item.icon.hex}` }}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="#fff">
          <path d={item.icon.path} />
        </svg>
      </a>
    )
  }
  return (
    <a
      href={item.href}
      target="_blank"
      rel="noreferrer"
      title={item.label}
      aria-label={item.label}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/60 transition hover:bg-white/10"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
        <path d={GENERIC_LINK_ICON_PATH} />
      </svg>
    </a>
  )
}

function CategoryRow({ label, items }: { label: string; items: LinkItem[] }) {
  if (items.length === 0) return null
  return (
    <div className="mt-3">
      <p className="text-xs uppercase tracking-wide text-white/40">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <IconBadge key={item.key} item={item} />
        ))}
      </div>
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
  for (const link of externalLinks) {
    if (!LISTEN_TYPES.has(link.link_type)) continue
    listenItems.push({
      key: link.id,
      icon: getServiceIcon(link.url),
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
    officialSnsItems.push({
      key: link.id,
      icon: getServiceIcon(link.url),
      href: link.url,
      label: getLinkLabel(link.url, link.link_type),
    })
  }

  const infoItems: LinkItem[] = []
  for (const link of externalLinks) {
    if (!INFO_TYPES.has(link.link_type)) continue
    infoItems.push({
      key: link.id,
      icon: getServiceIcon(link.url),
      href: link.url,
      label: getLinkLabel(link.url, link.link_type),
    })
  }

  if (listenItems.length === 0 && officialSnsItems.length === 0 && infoItems.length === 0) {
    return null
  }

  return (
    <div>
      <CategoryRow label="視聴" items={listenItems} />
      <CategoryRow label="公式・SNS" items={officialSnsItems} />
      <CategoryRow label="情報" items={infoItems} />
    </div>
  )
}
