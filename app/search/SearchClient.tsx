'use client'

import { useSearchParams } from 'next/navigation'
import CatalogSearchBox from '@/app/components/CatalogSearchBox'

export default function SearchClient() {
  const searchParams = useSearchParams()
  const initialQuery = searchParams.get('q') ?? ''

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">検索</h1>

      <div className="mt-6">
        <CatalogSearchBox variant="page" initialQuery={initialQuery} autoFocus />
      </div>
    </div>
  )
}
