const WIKIDATA_API_BASE = 'https://www.wikidata.org/w/api.php'
const WIKIDATA_SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql'
const USER_AGENT = 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type WikidataSearchResult = {
  qid: string
  label: string
  description: string | null
}

export async function searchWikidataEntity(name: string): Promise<WikidataSearchResult[]> {
  await sleep(300)
  const url = `${WIKIDATA_API_BASE}?action=wbsearchentities&search=${encodeURIComponent(name)}&language=ja&format=json&limit=5`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) {
    throw new Error(`Wikidata API error (search): ${res.status}`)
  }
  const data = await res.json()
  return (data.search ?? []).map((r: any) => ({
    qid: r.id,
    label: r.label ?? r.id,
    description: r.description ?? null,
  }))
}

export type WikidataOriginCoordinates = {
  latitude: number
  longitude: number
  placeLabel: string
}

export async function fetchOriginCoordinates(qid: string): Promise<WikidataOriginCoordinates | null> {
  if (!/^Q\d+$/.test(qid)) return null
  await sleep(300)
  const query = `SELECT ?place ?placeLabel ?coord WHERE { wd:${qid} wdt:P19|wdt:P740 ?place . ?place wdt:P625 ?coord . SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". } } LIMIT 1`
  const url = `${WIKIDATA_SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
  if (!res.ok) {
    throw new Error(`Wikidata API error (SPARQL): ${res.status}`)
  }
  const data = await res.json()
  const binding = data.results?.bindings?.[0]
  if (!binding) return null

  const coordValue: string | undefined = binding.coord?.value
  if (!coordValue) return null

  // "Point(経度 緯度)" 形式(実データで確認済み、経度が先)
  const match = coordValue.match(/Point\(([-\d.]+) ([-\d.]+)\)/)
  if (!match) return null

  return {
    longitude: Number(match[1]),
    latitude: Number(match[2]),
    placeLabel: binding.placeLabel?.value ?? '',
  }
}

export type WikidataRecordLabel = {
  name: string
  /** 加入年。WikidataのP580(開始日)修飾子から取れた場合のみ。無ければnull
   * (実データで確認済み: The Supremesの例では2件のレーベルとも開始日は未設定だった) */
  startYear: number | null
}

/** WikidataのP264(record label)プロパティから所属レーベルの一覧を取得する */
export async function fetchRecordLabels(qid: string): Promise<WikidataRecordLabel[]> {
  if (!/^Q\d+$/.test(qid)) return []
  await sleep(300)
  const query = `SELECT ?labelLabel ?start WHERE { wd:${qid} p:P264 ?stmt . ?stmt ps:P264 ?label . OPTIONAL { ?stmt pq:P580 ?start . } SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". } }`
  const url = `${WIKIDATA_SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
  if (!res.ok) {
    throw new Error(`Wikidata API error (SPARQL): ${res.status}`)
  }
  const data = await res.json()
  return (data.results?.bindings ?? [])
    .map((b: any) => ({
      name: b.labelLabel?.value ?? '',
      startYear: b.start?.value ? Number(String(b.start.value).slice(0, 4)) : null,
    }))
    .filter((l: WikidataRecordLabel) => l.name)
}

/**
 * WikidataのP18(image)プロパティからWikimedia Commonsのファイル名を取得し、
 * Special:FilePath経由の直リンクURLに変換する(Commonsの標準的な直リンク方式。
 * リダイレクトを介して実ファイルを返すため、<img src>にそのまま使える)。
 */
export async function fetchImageUrl(qid: string): Promise<string | null> {
  if (!/^Q\d+$/.test(qid)) return null
  await sleep(300)
  const query = `SELECT ?image WHERE { wd:${qid} wdt:P18 ?image . } LIMIT 1`
  const url = `${WIKIDATA_SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
  if (!res.ok) {
    throw new Error(`Wikidata API error (SPARQL): ${res.status}`)
  }
  const data = await res.json()
  const binding = data.results?.bindings?.[0]
  const imageUrl: string | undefined = binding?.image?.value
  if (!imageUrl) return null

  // imageUrlは commons.wikimedia.org/wiki/Special:FilePath/<ファイル名> の形式で
  // 返るが、httpスキームなのでhttpsに寄せる(実データで確認済み: サイト全体が
  // httpsのため、混在コンテンツを避ける)。
  try {
    const parsed = new URL(imageUrl)
    parsed.protocol = 'https:'
    return parsed.toString()
  } catch {
    return null
  }
}
