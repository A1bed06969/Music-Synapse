'use client'

import { useState } from 'react'

type Rotation = {
  id: string
  period_start_date: string
  music_type: string
  media_program:
    | {
        program_name: string
        media: { name: string }[]
      }[]
    | null
}

export default function RotationModal({ rotations }: { rotations: Rotation[] }) {
  const [isOpen, setIsOpen] = useState(false)

  if (!rotations || rotations.length === 0) return null

  // グループ化: メディア名 → 局ごと
  const grouped = new Map<string, Rotation[]>()
  for (const r of rotations) {
    const programs = Array.isArray(r.media_program) ? r.media_program : [r.media_program]
    const program = programs?.[0]
    const media = program ? (Array.isArray(program.media) ? program.media[0] : program.media) : null
    const key = `${media?.name || '不明'}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(r)
  }

  const displayCount = Math.min(3, rotations.length)
  const remainingCount = rotations.length - displayCount

  return (
    <>
      <section className="mt-8">
        <h2 className="text-xs font-medium uppercase tracking-wide text-white/40">パワープレイ/ヘビロテ実績</h2>
        <ul className="mt-3 space-y-1.5 text-sm text-white/70">
          {rotations.slice(0, displayCount).map((row) => {
            const programs = Array.isArray(row.media_program) ? row.media_program : [row.media_program]
            const program = programs?.[0]
            const media = program ? (Array.isArray(program.media) ? program.media[0] : program.media) : null
            return (
              <li key={row.id}>
                {media?.name} {program?.program_name}
                <span className="text-white/40"> ・ {row.period_start_date}</span>
              </li>
            )
          })}
        </ul>

        {remainingCount > 0 && (
          <button
            onClick={() => setIsOpen(true)}
            className="mt-3 text-sm text-white/50 hover:text-white/80 transition-colors"
          >
            ほか全国{rotations.length}局 →
          </button>
        )}
      </section>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="relative w-full max-w-2xl max-h-[80vh] rounded-lg bg-[#1a1a1a] border border-white/10 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ヘッダー */}
            <div className="sticky top-0 z-10 bg-[#1a1a1a] border-b border-white/10 px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">パワープレイ/ヘビロテ実績</h3>
              <button
                onClick={() => setIsOpen(false)}
                className="text-white/40 hover:text-white/80 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            {/* コンテンツ */}
            <div className="px-6 py-4 space-y-6">
              {Array.from(grouped.entries()).map(([mediaName, entries]) => (
                <div key={mediaName}>
                  <h4 className="text-sm font-medium text-white/70 mb-2">{mediaName}</h4>
                  <ul className="space-y-1 text-sm text-white/60">
                    {entries.map((row) => {
                      const programs = Array.isArray(row.media_program) ? row.media_program : [row.media_program]
                      const program = programs?.[0]
                      return (
                        <li key={row.id}>
                          {program?.program_name}
                          <span className="text-white/40"> ・ {row.period_start_date}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
