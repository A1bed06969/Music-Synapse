'use client'

import { useState } from 'react'

type Item = { id: string; label: string }

export default function SearchableSelect({
  items,
  name,
  placeholder,
}: {
  items: Item[]
  name: string
  placeholder: string
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Item | null>(null)
  const [open, setOpen] = useState(false)

  const filtered = query
    ? items.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())).slice(0, 20)
    : []

  function selectItem(item: Item) {
    setSelected(item)
    setQuery('')
    setOpen(false)
  }

  function clearSelection() {
    setSelected(null)
    setQuery('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered.length > 0) selectItem(filtered[0])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative w-full max-w-xs">
      <input type="hidden" name={name} value={selected?.id ?? ''} />
      {selected ? (
        <div className="flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white">
          <span className="flex-1 truncate">{selected.label}</span>
          <button
            type="button"
            onClick={clearSelection}
            className="text-white/40 hover:text-white"
            aria-label="選択を解除"
          >
            ×
          </button>
        </div>
      ) : (
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none"
        />
      )}
      {open && query && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-white/15 bg-black shadow-lg">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-white/40">該当なし</p>
          ) : (
            filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectItem(item)}
                className="block w-full px-3 py-2 text-left text-sm text-white hover:bg-white/10"
              >
                {item.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
