import { PREFECTURE_COORDS } from '@/utils/prefectures'

// 番組選択を地方→都道府県(北から南)→局名→番組名の順に並べる。PREFECTURE_COORDSは
// JISコード順(北海道=0 … 沖縄=46)なので、その添字で地方を判定する
const REGIONS: { name: string; until: number }[] = [
  { name: '北海道', until: 0 },
  { name: '東北', until: 6 },
  { name: '関東', until: 13 },
  { name: '中部', until: 22 },
  { name: '近畿', until: 29 },
  { name: '中国', until: 34 },
  { name: '四国', until: 38 },
  { name: '九州・沖縄', until: 46 },
]
const PREFECTURE_ORDER = new Map(PREFECTURE_COORDS.map((p, i) => [p.name, i]))

export type ProgramRow = {
  id: string
  program_name: string
  media:
    | { name: string; prefecture: string | null; area: string | null }
    | { name: string; prefecture: string | null; area: string | null }[]
    | null
}

function prefectureIndex(media: { prefecture: string | null; area: string | null } | null): number | null {
  if (media?.prefecture && PREFECTURE_ORDER.has(media.prefecture)) return PREFECTURE_ORDER.get(media.prefecture)!
  // 都道府県が無い広域局(例: 関西AM5局の「近畿広域」)はエリア名の先頭の県で代用する
  if (media?.area?.includes('近畿')) return PREFECTURE_ORDER.get('大阪府') ?? null
  const byArea = PREFECTURE_COORDS.findIndex((p) => media?.area && p.name.startsWith(media.area.slice(0, 2)))
  return byArea >= 0 ? byArea : null
}

export function groupProgramsByRegion(rows: ProgramRow[]) {
  const items = rows.map((p) => {
    const media = Array.isArray(p.media) ? p.media[0] : p.media
    const index = prefectureIndex(media ?? null)
    return {
      id: p.id,
      label: `${media?.prefecture ? `${media.prefecture.replace(/[都府県]$/, '')} / ` : ''}${media?.name ?? ''} — ${p.program_name}`,
      index: index ?? 999,
      region: index === null ? 'その他' : REGIONS.find((r) => index <= r.until)!.name,
      mediaName: media?.name ?? '',
      programName: p.program_name,
    }
  })
  items.sort(
    (a, b) =>
      a.index - b.index || a.mediaName.localeCompare(b.mediaName, 'ja') || a.programName.localeCompare(b.programName, 'ja')
  )
  const groups: { region: string; programs: typeof items }[] = []
  for (const item of items) {
    const last = groups[groups.length - 1]
    if (last?.region === item.region) last.programs.push(item)
    else groups.push({ region: item.region, programs: [item] })
  }
  return groups
}
