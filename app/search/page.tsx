import { Suspense } from 'react'
import SearchClient from './SearchClient'

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-2xl px-6 py-12 text-sm text-white/40">読み込み中...</div>}>
      <SearchClient />
    </Suspense>
  )
}
