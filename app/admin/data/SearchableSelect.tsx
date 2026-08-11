'use client'

import { useEffect, useRef, useState, useTransition } from 'react'

type Item = { id: string; label: string }

export default function SearchableSelect({
  searchAction,
  name,
  placeholder,
  multiple = false,
  defaultSelected = [],
}: {
  searchAction: (query: string) => Promise<Item[]>
  name: string
  placeholder: string
  /** trueの場合、同じ曲がシングル/EP版とアルバム収録版など複数のtrack行に
   * 分かれているケースで、まとめて複数選択できるようにする。 */
  multiple?: boolean
  /** 編集画面で、既存データの選択状態を初期表示するために使う。 */
  defaultSelected?: Item[]
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Item[]>([])
  const [isPending, startTransition] = useTransition()
  const [selected, setSelected] = useState<Item[]>(defaultSelected)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)

  // Server ActionをuseEffect/イベントハンドラから直接呼ぶ場合、Next.jsの規約上
  // startTransitionで包む必要がある(<form action>やformActionでは自動的に
  // 包まれるが、この検索欄のような都度呼び出しでは手動で包む必要がある)。
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query) {
      setResults([])
      return
    }
    debounceRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current
      startTransition(async () => {
        const items = await searchAction(query)
        if (requestId !== requestIdRef.current) return // 古いリクエストの結果は無視
        setResults(items)
      })
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, searchAction])

  function selectItem(item: Item) {
    if (multiple) {
      setSelected((prev) => (prev.some((s) => s.id === item.id) ? prev : [...prev, item]))
      setQuery('')
      setResults([])
      // 複数選択時は開いたままにして、続けて次の候補を選べるようにする
    } else {
      setSelected([item])
      setQuery('')
      setResults([])
      setOpen(false)
    }
  }

  function removeItem(id: string) {
    setSelected((prev) => prev.filter((s) => s.id !== id))
  }

  function clearSelection() {
    setSelected([])
    setQuery('')
  }

  const visibleResults = multiple ? results.filter((r) => !selected.some((s) => s.id === r.id)) : results

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (visibleResults.length > 0) selectItem(visibleResults[0])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showInput = multiple || selected.length === 0

  return (
    <div className="relative w-full max-w-xs">
      {selected.map((item) => (
        <input key={item.id} type="hidden" name={name} value={item.id} />
      ))}

      {multiple && selected.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {selected.map((item) => (
            <span
              key={item.id}
              className="flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-white"
            >
              <span className="max-w-[220px] truncate">{item.label}</span>
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                className="text-white/40 hover:text-white"
                aria-label="選択を解除"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {!multiple && selected.length > 0 ? (
        <div className="flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white">
          <span className="flex-1 truncate">{selected[0].label}</span>
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
        showInput && (
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
        )
      )}

      {open && query && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-white/15 bg-black shadow-lg">
          {isPending ? (
            <p className="px-3 py-2 text-sm text-white/40">検索中...</p>
          ) : visibleResults.length === 0 ? (
            <p className="px-3 py-2 text-sm text-white/40">該当なし</p>
          ) : (
            visibleResults.map((item) => (
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
