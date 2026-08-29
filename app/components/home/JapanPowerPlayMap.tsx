import {
  PREFECTURE_SHAPES,
  JAPAN_MAP_VIEWBOX,
  JAPAN_MAP_OUTER_TRANSFORM,
  JAPAN_MAP_GROUP_TRANSFORM,
} from '@/utils/japan-map'

export type PowerPlayPrefecture = { prefecture: string; mediaCount: number }

/** TOPページ用の最小限の日本地図。/media/on-airの詳細なPrefectureMapとは違い、
 * クリック・ポップアップは持たず、背景要素として都道府県の輪郭を薄く、
 * 実績がある県だけを小さなドットで示す(地理的精度より「日本地図に見える」ことを優先)。 */
export default function JapanPowerPlayMap({ data, accent }: { data: PowerPlayPrefecture[]; accent: string }) {
  const dataByPrefecture = new Map(data.map((d) => [d.prefecture, d]))
  const maxCount = Math.max(1, ...data.map((d) => d.mediaCount))

  return (
    <svg viewBox={JAPAN_MAP_VIEWBOX} className="h-full w-full select-none" preserveAspectRatio="xMidYMid meet">
      <g transform={JAPAN_MAP_OUTER_TRANSFORM}>
        <g transform={JAPAN_MAP_GROUP_TRANSFORM}>
          {PREFECTURE_SHAPES.map((pref) => {
            const entry = dataByPrefecture.get(pref.name)
            return (
              <g key={pref.name} transform={pref.transform}>
                {pref.shapes.map((shape, i) =>
                  shape.tag === 'polygon' ? (
                    <polygon
                      key={i}
                      points={shape.attr}
                      fill="rgba(255,255,255,0.035)"
                      stroke="rgba(255,255,255,0.12)"
                      strokeWidth={1.5}
                      strokeLinejoin="round"
                    />
                  ) : (
                    <path
                      key={i}
                      d={shape.attr}
                      fill="rgba(255,255,255,0.035)"
                      stroke="rgba(255,255,255,0.12)"
                      strokeWidth={1.5}
                      strokeLinejoin="round"
                    />
                  )
                )}
                {entry && (
                  <circle
                    cx={pref.labelX}
                    cy={pref.labelY}
                    r={8 + (entry.mediaCount / maxCount) * 16}
                    fill={accent}
                    fillOpacity={0.55}
                  />
                )}
              </g>
            )
          })}
        </g>
      </g>
    </svg>
  )
}
