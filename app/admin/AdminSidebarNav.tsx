'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_GROUPS: { label: string; links: { href: string; label: string }[] }[] = [
  {
    label: '新規登録',
    links: [
      { href: '/admin/import', label: 'iTunes一括登録' },
      { href: '/admin/import/search', label: '検索して登録' },
      { href: '/admin/data/discguides', label: 'ディスクガイド' },
    ],
  },
  {
    label: 'アーティスト',
    links: [
      { href: '/admin/data', label: 'アーティスト一覧・統合' },
      { href: '/admin/data/artists/review', label: '確認待ち一覧' },
      { href: '/admin/data/artists/unmatched', label: '未マッチアーティストを検索' },
      { href: '/admin/data/artists/unreleased', label: '未解禁アーティスト検出' },
      { href: '/admin/data/artists/musicbrainz-queue', label: 'MusicBrainz未解決' },
      { href: '/admin/data/artists/geo', label: '座標を一括更新' },
      { href: '/admin/data/artists/images', label: '画像を一括更新' },
    ],
  },
  {
    label: 'イベント・フェス',
    links: [
      { href: '/admin/data/events', label: 'イベント' },
      { href: '/admin/data/events/festival-pilot', label: '世界のフェス出演者収集' },
      { href: '/admin/data/events/festival-pilot/datasets', label: 'フェス出演者データ管理' },
    ],
  },
  {
    label: 'マスタデータ',
    links: [
      { href: '/admin/data/genres', label: 'ジャンル' },
      { href: '/admin/data/relations', label: '相関図データ' },
      { href: '/admin/data/labels', label: 'レーベル' },
      { href: '/admin/data/media', label: 'メディア&オンエア' },
      { href: '/admin/data/media/radio-pilot', label: 'ラジオ局PP収集' },
      { href: '/admin/data/curation', label: 'キュレーションコンテンツ' },
      { href: '/admin/data/sync', label: 'タイアップ' },
      { href: '/admin/data/awards', label: 'アワード' },
      { href: '/admin/data/shops', label: 'レコードショップ' },
      { href: '/admin/data/livehouses', label: 'ライブハウス' },
      { href: '/admin/data/venues', label: '会場' },
    ],
  },
]

export default function AdminSidebarNav() {
  const pathname = usePathname()

  return (
    <nav className="hidden w-56 shrink-0 border-r border-white/10 py-8 pl-4 pr-4 md:block">
      <Link href="/admin/data" className="text-sm font-bold text-white/80 hover:text-white">
        管理画面
      </Link>
      <div className="mt-6 flex flex-col gap-6">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/30">{group.label}</p>
            <ul className="mt-2 flex flex-col gap-0.5">
              {group.links.map((link) => {
                const active = pathname === link.href
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className={`block rounded px-2 py-1 text-xs transition ${
                        active ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white/80'
                      }`}
                    >
                      {link.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  )
}
