'use client'

export default function RegionBar({
  regions,
  activeRegion,
  onSelectRegion,
}: {
  regions: string[]
  activeRegion: string | null
  onSelectRegion: (region: string | null) => void
}) {
  if (regions.length === 0) return null

  return (
    <div className="mt-4 flex flex-wrap gap-1.5">
      {regions.map((region) => (
        <button
          key={region}
          type="button"
          onClick={() => onSelectRegion(activeRegion === region ? null : region)}
          className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
            activeRegion === region
              ? 'border-white/50 bg-white/10 text-white'
              : 'border-white/15 text-white/50 hover:border-white/30 hover:text-white/80'
          }`}
        >
          {region}
        </button>
      ))}
    </div>
  )
}
