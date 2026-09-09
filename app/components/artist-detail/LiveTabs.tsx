'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

export default function LiveTabs({ tab }: { tab: 'upcoming' | 'past' }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function navigate(nextTab: 'upcoming' | 'past') {
    const params = new URLSearchParams(searchParams.toString())
    if (nextTab === 'upcoming') params.delete('tab')
    else params.set('tab', 'past')
    const search = params.toString()
    router.push(search ? `${pathname}?${search}` : pathname)
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => navigate('upcoming')}
        className={`rounded-full border px-3 py-1 text-xs ${tab === 'upcoming' ? 'border-white bg-white text-black' : 'border-white/15 text-white/60'}`}
      >
        Upcoming
      </button>
      <button
        type="button"
        onClick={() => navigate('past')}
        className={`rounded-full border px-3 py-1 text-xs ${tab === 'past' ? 'border-white bg-white text-black' : 'border-white/15 text-white/60'}`}
      >
        Past
      </button>
    </div>
  )
}
