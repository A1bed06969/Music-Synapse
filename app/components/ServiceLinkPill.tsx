import type { ServiceIcon } from '@/utils/serviceIcons'

/** サブスク配信・SNS・外部サイトへのリンクを表す共通の見た目。
 * ブランドアイコン(simple-icons)があればそれを、無ければファビコンを、
 * どちらも無ければアイコン無しでラベルだけを表示する。
 * アルバム/トラックページの配信リンク(ListenLinks)とアーティストページの
 * 配信/SNSリンク(ArtistLinkIcons)の両方から使う。 */
export default function ServiceLinkPill({
  href,
  label,
  icon,
  faviconUrl,
}: {
  href: string
  label: string
  icon?: ServiceIcon | null
  faviconUrl?: string | null
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/20 px-3 py-1 text-xs text-white/70 transition hover:border-white/40 hover:text-white"
    >
      {icon ? (
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm"
          style={{ backgroundColor: `#${icon.hex}` }}
        >
          <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="#fff">
            <path d={icon.path} />
          </svg>
        </span>
      ) : faviconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={faviconUrl} alt="" className="h-4 w-4 shrink-0 rounded-sm" />
      ) : null}
      {label}
    </a>
  )
}
