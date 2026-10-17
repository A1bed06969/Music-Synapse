import Link from 'next/link'

/** 連載ページの右カラムに置く、表示の切り替え(一覧/カレンダー/マップ など)。選択中は連載の色で光らせる */
export default function HubViewNav({
  title = 'VIEW',
  color,
  activeKey,
  items,
}: {
  title?: string
  color: string
  activeKey: string
  items: { key: string; label: string; href: string }[]
}) {
  return (
    <nav aria-label={title}>
      <p className="text-[11px] tracking-[0.2em] text-white/40">{title}</p>
      <ul className="mt-3 flex flex-wrap gap-2 lg:flex-col lg:gap-0.5">
        {items.map((item) => {
          const active = item.key === activeKey
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`block rounded-lg px-3 py-2 text-[13px] font-bold tracking-wide transition ${active ? 'text-white' : 'text-white/70 hover:bg-white/[0.04] hover:text-white'}`}
                style={active ? { backgroundColor: `${color}29`, boxShadow: `inset 3px 0 0 ${color}` } : undefined}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
