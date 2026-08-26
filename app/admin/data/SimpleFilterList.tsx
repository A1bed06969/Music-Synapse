'use client'

import { useMemo, useState } from 'react'
import { inputClass } from './adminUi'

/** アクション無しの単純な一覧(名前を突き合わせるだけの表示)を、絞り込み検索付きで
 * 表示する共通コンポーネント。長い一覧をページ全体のスクロールに出さないよう、
 * 一覧自体を高さ固定+内部スクロールにする。 */
export default function SimpleFilterList({
  items,
  placeholder,
}: {
  items: { key: string | number; text: string; filterText: string }[]
  placeholder: string
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => (q ? items.filter((i) => i.filterText.toLowerCase().includes(q)) : items), [items, q])

  return (
    <div className="mt-4">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className={`${inputClass} max-w-xs`}
      />
      <p className="mt-2 text-xs text-white/40">{filtered.length}件</p>
      <ul className="mt-1 max-h-[50vh] space-y-1 overflow-y-auto text-sm text-white/60">
        {filtered.map((item) => (
          <li key={item.key}>{item.text}</li>
        ))}
      </ul>
    </div>
  )
}
