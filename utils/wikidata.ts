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
