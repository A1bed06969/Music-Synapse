export type ListenLinkIds = {
  appleMusicId?: string | null
  spotifyId?: string | null
  youtubeMusicId?: string | null
  amazonMusicId?: string | null
}

type Item = { key: string; label: string; href: string }

/** アルバム/トラック詳細ページのヘッダーに並べる配信サービスへのリンク。
 * yoynが小さい丸アイコンを並べるのに対し、こちらはサービス名を出したボタンにして
 * 見た目を分ける(設計書「①ヘッダー行」参照)。値が無いサービスは出さない。 */
export default function ListenLinks({
  kind,
  ids,
  extraLinks = [],
}: {
  kind: 'album' | 'track'
  ids: ListenLinkIds
  extraLinks?: { label: string; href: string }[]
}) {
  const items: Item[] = []

  if (ids.appleMusicId) {
    items.push({
      key: 'apple',
      label: 'Apple Music',
      href:
        kind === 'album'
          ? `https://music.apple.com/jp/album/${ids.appleMusicId}`
          : `https://music.apple.com/jp/song/${ids.appleMusicId}`,
    })
  }
  if (ids.spotifyId) {
    items.push({
      key: 'spotify',
      label: 'Spotify',
      href:
        kind === 'album'
          ? `https://open.spotify.com/album/${ids.spotifyId}`
          : `https://open.spotify.com/track/${ids.spotifyId}`,
    })
  }
  if (ids.youtubeMusicId) {
    items.push({
      key: 'youtube-music',
      label: 'YouTube Music',
      href:
        kind === 'album'
          ? `https://music.youtube.com/browse/${ids.youtubeMusicId}`
          : `https://music.youtube.com/watch?v=${ids.youtubeMusicId}`,
    })
  }
  if (ids.amazonMusicId) {
    items.push({
      key: 'amazon-music',
      label: 'Amazon Music',
      href:
        kind === 'album'
          ? `https://music.amazon.co.jp/albums/${ids.amazonMusicId}`
          : `https://music.amazon.co.jp/tracks/${ids.amazonMusicId}`,
    })
  }

  for (const [i, link] of extraLinks.entries()) {
    items.push({ key: `extra-${i}`, label: link.label, href: link.href })
  }

  if (items.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <a
          key={item.key}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/70 transition hover:border-white/40 hover:text-white"
        >
          {item.label}
        </a>
      ))}
    </div>
  )
}
