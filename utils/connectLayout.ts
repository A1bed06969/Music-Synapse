// utils/connectLayout.ts
//
// Connect The Music Makers の「ドラマの人物相関図」風の配置を、データから自動で組み立てる(純粋関数)。
// 中央に本人のカード、左右・上下の4方向(レーン)に、つながる相手のカードを並べ、線は縦・横の折れ線で通す。
//
// 線が交わらないための決まり(左右のレーン):
//   - 本人カードの側面に、上から順に出口(ポート)を並べ、レーンの上の相手ほど上のポートを使う
//   - ポートから出た線は「幹(縦の線)」で相手の高さまで行き、最後は横に相手へ入る
//   - 本人の高さに近い相手ほど、幹を本人から遠く(外側)に置く。遠い相手ほど内側
//   こうすると、どの2本も交わらない(上下それぞれで成り立ち、真ん中の相手は横一直線)。
// 上下のレーン(最大3人)は、幹の内側(本人の横幅の範囲)だけを通るので、左右の線とも交わらない。

export type ConnectEdgeKind = 'collab' | 'label' | 'related'
export type ConnectLane = 'left' | 'right' | 'top' | 'bottom'

export type ConnectItem = {
  id: string
  name: string
  /** カードの2行目(例: 「共演 3曲」「所属 2012〜」) */
  sub: string
  image: string | null
  kind: 'artist' | 'label'
  href: string
  edge: {
    kind: ConnectEdgeKind
    /** 線の上のラベル(1行目: 関係、2行目: 代表作など)。上下のレーンは出さない */
    lines: string[]
    /** 矢印の向き。out = 本人 → 相手、in = 相手 → 本人 */
    dir: 'in' | 'out' | 'both' | 'none'
  }
}

export type PlacedNode = ConnectItem & { x: number; y: number; lane: ConnectLane }
export type PlacedEdge = {
  id: string
  kind: ConnectEdgeKind
  dir: ConnectItem['edge']['dir']
  /** 本人側 → 相手側の順 */
  points: [number, number][]
  label: { x: number; y: number; lines: string[] } | null
}
export type ConnectLayout = {
  width: number
  height: number
  center: { x: number; y: number }
  /** まわりのカードの大きさ(図の種類で違う) */
  card: { w: number; h: number }
  nodes: PlacedNode[]
  edges: PlacedEdge[]
}

export const CARD = { w: 140, h: 52 }
export const CENTER_CARD = { w: 196, h: 80 }
export const SIDE_MAX = 6
export const TOPBOTTOM_MAX = 3

const SPACING = 88 // 左右レーンのカードの縦の間隔
const TRUNK0 = CENTER_CARD.w / 2 + 74 // いちばん内側の幹の位置(本人の中心から)
const TRUNK_GAP = 22
const LABEL_ZONE = 196 // 幹の外側から相手カードまでの、ラベルを置く幅
const ITEM_X = TRUNK0 + TRUNK_GAP * 2 + LABEL_ZONE + CARD.w / 2
const TB_Y = 292 // 上下レーンのカードの中心(本人の中心から)
const TB_TRUNK = CENTER_CARD.h / 2 + 88
const PILL = { w: 184, h: 34 } // 外枠の計算用のラベルの大きさの目安
const MARGIN = 20

function sideLane(items: ConnectItem[], sign: 1 | -1, lane: ConnectLane, nodes: PlacedNode[], edges: PlacedEdge[]) {
  const n = items.length
  const mid = (n - 1) / 2
  const step = n > 1 ? (CENTER_CARD.h - 22) / (n - 1) : 0
  const centerEdge = (sign * CENTER_CARD.w) / 2
  const itemEdge = sign * (ITEM_X - CARD.w / 2)
  items.forEach((it, i) => {
    const iy = (i - mid) * SPACING
    const py = (i - mid) * step
    const dist = Math.abs(i - mid)
    let points: [number, number][]
    let lastX = centerEdge
    if (dist === 0) {
      points = [
        [centerEdge, 0],
        [itemEdge, 0],
      ]
    } else {
      const rank = Math.round(mid - dist)
      const tx = sign * (TRUNK0 + TRUNK_GAP * rank)
      lastX = tx
      points = [
        [centerEdge, py],
        [tx, py],
        [tx, iy],
        [itemEdge, iy],
      ]
    }
    nodes.push({ ...it, x: sign * ITEM_X, y: iy, lane })
    edges.push({
      id: `${lane}-${it.id}`,
      kind: it.edge.kind,
      dir: it.edge.dir,
      points,
      label: it.edge.lines.length ? { x: (lastX + itemEdge) / 2, y: iy, lines: it.edge.lines } : null,
    })
  })
}

function tbLane(items: ConnectItem[], sign: 1 | -1, lane: ConnectLane, nodes: PlacedNode[], edges: PlacedEdge[]) {
  const xs = items.length === 1 ? [0] : items.length === 2 ? [-84, 84] : [-158, 0, 158]
  const centerEdge = (sign * CENTER_CARD.h) / 2
  const itemEdge = sign * (TB_Y - CARD.h / 2)
  items.forEach((it, i) => {
    const x = xs[i]
    const px = Math.round(x * 0.3)
    const points: [number, number][] =
      x === 0
        ? [
            [0, centerEdge],
            [0, itemEdge],
          ]
        : [
            [px, centerEdge],
            [px, sign * TB_TRUNK],
            [x, sign * TB_TRUNK],
            [x, itemEdge],
          ]
    nodes.push({ ...it, x, y: sign * TB_Y, lane })
    edges.push({ id: `${lane}-${it.id}`, kind: it.edge.kind, dir: it.edge.dir, points, label: null })
  })
}

export function layoutConnect(lanes: Record<ConnectLane, ConnectItem[]>): ConnectLayout {
  const nodes: PlacedNode[] = []
  const edges: PlacedEdge[] = []
  sideLane(lanes.right.slice(0, SIDE_MAX), 1, 'right', nodes, edges)
  sideLane(lanes.left.slice(0, SIDE_MAX), -1, 'left', nodes, edges)
  tbLane(lanes.top.slice(0, TOPBOTTOM_MAX), -1, 'top', nodes, edges)
  tbLane(lanes.bottom.slice(0, TOPBOTTOM_MAX), 1, 'bottom', nodes, edges)

  // 外枠: 本人・相手のカードと、線のラベルが収まる大きさ
  let minX = -CENTER_CARD.w / 2, maxX = CENTER_CARD.w / 2, minY = -CENTER_CARD.h / 2, maxY = CENTER_CARD.h / 2
  for (const n of nodes) {
    minX = Math.min(minX, n.x - CARD.w / 2)
    maxX = Math.max(maxX, n.x + CARD.w / 2)
    minY = Math.min(minY, n.y - CARD.h / 2)
    maxY = Math.max(maxY, n.y + CARD.h / 2)
  }
  for (const e of edges) {
    if (!e.label) continue
    minY = Math.min(minY, e.label.y - PILL.h / 2)
    maxY = Math.max(maxY, e.label.y + PILL.h / 2)
  }
  // 左右どちらかが空でも、本人が中央に来るよう左右対称にする
  const half = Math.max(-minX, maxX)
  minX = -half
  maxX = half
  const ox = -minX + MARGIN
  const oy = -minY + MARGIN
  const shift = ([x, y]: [number, number]): [number, number] => [x + ox, y + oy]

  return {
    width: Math.round(maxX - minX + MARGIN * 2),
    height: Math.round(maxY - minY + MARGIN * 2),
    center: { x: ox, y: oy },
    card: CARD,
    nodes: nodes.map((n) => ({ ...n, x: n.x + ox, y: n.y + oy })),
    edges: edges.map((e) => ({
      ...e,
      points: e.points.map(shift),
      label: e.label ? { ...e.label, x: e.label.x + ox, y: e.label.y + oy } : null,
    })),
  }
}

// ---- 縦型: 上にレーベル、その下に本人、本人の下から1本の幹を下ろし、左右交互にカードを枝分かれさせる ----
// 3カラムの中央(幅が広いとき)は、枝を長くして、枝の上に関係のラベルを載せる(layoutConnectTree)。
// スマホなど狭いときは、枝を短くしてラベルは出さず、カードの2行目に件数を出す(layoutConnectCompact)。
export const COMPACT_CARD = { w: 158, h: 52 }
export const VERTICAL_MAX = 12

function layoutVertical(top: ConnectItem[], rows: ConnectItem[], branch: number, rowGap: number, withLabels: boolean): ConnectLayout {
  const nodes: PlacedNode[] = []
  const edges: PlacedEdge[] = []
  const half = branch + COMPACT_CARD.w // 中心から外側のカードの外端まで
  const cardX = branch + COMPACT_CARD.w / 2
  const tops = top.slice(0, 2)
  const topY = COMPACT_CARD.h / 2
  const centerY = tops.length ? topY + COMPACT_CARD.h / 2 + 52 + CENTER_CARD.h / 2 : CENTER_CARD.h / 2
  tops.forEach((it, i) => {
    const x = tops.length === 1 ? 0 : i === 0 ? -Math.min(cardX, 110) : Math.min(cardX, 110)
    nodes.push({ ...it, x, y: topY, lane: 'top' })
    const from: [number, number] = [tops.length === 1 ? 0 : x * 0.25, centerY - CENTER_CARD.h / 2]
    const midY = topY + COMPACT_CARD.h / 2 + 22
    edges.push({
      id: `top-${it.id}`,
      kind: it.edge.kind,
      dir: it.edge.dir,
      points: x === 0 ? [from, [0, topY + COMPACT_CARD.h / 2]] : [from, [from[0], midY], [x, midY], [x, topY + COMPACT_CARD.h / 2]],
      label: null,
    })
  })
  const firstRowY = centerY + CENTER_CARD.h / 2 + 34 + COMPACT_CARD.h / 2
  const list = rows.slice(0, VERTICAL_MAX)
  list.forEach((it, i) => {
    const left = i % 2 === 0
    const sign = left ? -1 : 1
    const rowY = firstRowY + Math.floor(i / 2) * rowGap
    nodes.push({ ...it, x: sign * cardX, y: rowY, lane: left ? 'left' : 'right' })
    edges.push({
      id: `${left ? 'left' : 'right'}-${it.id}`,
      kind: it.edge.kind,
      dir: it.edge.dir,
      points: [
        [0, centerY + CENTER_CARD.h / 2],
        [0, rowY],
        [sign * branch, rowY],
      ],
      label: withLabels && it.edge.lines.length ? { x: sign * (branch / 2 + 4), y: rowY, lines: it.edge.lines } : null,
    })
  })
  const rowsCount = Math.ceil(list.length / 2)
  const bottom = rowsCount ? firstRowY + (rowsCount - 1) * rowGap + COMPACT_CARD.h / 2 : centerY + CENTER_CARD.h / 2
  const width = half * 2 + MARGIN * 2
  const ox = half + MARGIN
  const oy = MARGIN
  return {
    width: Math.round(width),
    height: Math.round(bottom + MARGIN * 2),
    center: { x: ox, y: centerY + oy },
    card: COMPACT_CARD,
    nodes: nodes.map((n) => ({ ...n, x: n.x + ox, y: n.y + oy })),
    edges: edges.map((e) => ({
      ...e,
      points: e.points.map(([px, py]) => [px + ox, py + oy] as [number, number]),
      label: e.label ? { ...e.label, x: e.label.x + ox, y: e.label.y + oy } : null,
    })),
  }
}

/** 3カラムの中央用(幅 約600): 枝の上に関係のラベル */
export function layoutConnectTree(top: ConnectItem[], rows: ConnectItem[]): ConnectLayout {
  return layoutVertical(top, rows, 142, 76, true)
}

/** スマホ用(幅 約400): ラベルなし */
export function layoutConnectCompact(top: ConnectItem[], rows: ConnectItem[]): ConnectLayout {
  return layoutVertical(top, rows, 22, 66, false)
}
