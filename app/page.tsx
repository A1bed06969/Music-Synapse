import Link from 'next/link'
import HomeSnapScrollEffect from '@/app/components/HomeSnapScrollEffect'
import { HOME_HEADER_HEIGHT_PX } from '@/app/components/SiteHeader'

type NavItem = { label: string; href: string }
type HomeSection = { title: string; subtitle: string; items: NavItem[] }

const SECTIONS: HomeSection[] = [
  {
    title: 'MUSIC SYNAPSE',
    subtitle: '音楽をつなぎ、新しい発見へ。',
    items: [
      { label: 'NEW RELEASE', href: '/albums?sort=release' },
      { label: 'FES & LIVE INFO', href: '/events' },
      { label: 'POWER PLAY / HEAVY ROTATION', href: '#' },
    ],
  },
  {
    title: 'MUSIC PLANET',
    subtitle: '世界中のアーティスト・ショップを地図で探す。',
    items: [
      { label: 'ARTIST', href: '/map' },
      { label: 'EVENT', href: '/events' },
      { label: 'SHOP', href: '/map' },
    ],
  },
  {
    title: 'MUSIC TAPESTRY',
    subtitle: 'アーティスト・ジャンル・レーベルのつながりを辿る。',
    items: [
      { label: 'ARTIST', href: '/artists' },
      { label: 'GENRE', href: '/genres' },
      { label: 'LABEL', href: '#' },
    ],
  },
  {
    title: 'MEDIA & DISC GUIDE',
    subtitle: 'メディアの企画・キュレーション・ディスクガイドを見る。',
    items: [
      { label: 'TIE UP', href: '/media/sync' },
      { label: 'CURATION', href: '/media/features' },
      { label: 'DISC GUIDE', href: '/discguides' },
    ],
  },
]

export default function Home() {
  return (
    <>
      <HomeSnapScrollEffect />
      {SECTIONS.map((section) => (
        <section
          key={section.title}
          className="flex h-screen snap-start flex-col md:flex-row"
          style={{ scrollMarginTop: HOME_HEADER_HEIGHT_PX }}
        >
          <div className="flex flex-1 flex-col items-start justify-center border-b border-white/10 px-8 py-10 md:border-b-0 md:border-r md:px-16">
            <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">{section.title}</h2>
            <p className="mt-4 max-w-md text-sm text-white/50 sm:text-base">{section.subtitle}</p>
          </div>
          <div className="flex flex-1 flex-col">
            {section.items.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="group flex flex-1 items-center justify-center border-b border-white/10 px-8 text-lg font-semibold tracking-wide text-white/70 transition last:border-b-0 hover:bg-white/5 hover:text-white sm:text-xl"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
