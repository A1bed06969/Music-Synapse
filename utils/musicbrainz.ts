const MUSICBRAINZ_BASE = 'https://musicbrainz.org/ws/2'
const USER_AGENT = 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type MusicBrainzSearchResult = {
  mbid: string
  name: string
  country: string | null
  type: string | null
  beginYear: number | null
}

export async function searchArtist(name: string): Promise<MusicBrainzSearchResult[]> {
  await sleep(1000)
  const url = `${MUSICBRAINZ_BASE}/artist?query=${encodeURIComponent(name)}&fmt=json&limit=5`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) {
    throw new Error(`MusicBrainz API error (artist search): ${res.status}`)
  }
  const data = await res.json()
  return (data.artists ?? []).map((a: any) => ({
    mbid: a.id,
    name: a.name,
    country: a.country ?? null,
    type: a.type ?? null,
    beginYear: a['life-span']?.begin ? Number(String(a['life-span'].begin).slice(0, 4)) : null,
  }))
}

const ALLOWED_LINK_TYPES = new Set([
  'streaming',
  'free streaming',
  'social network',
  'other databases',
  'allmusic',
  'discogs',
  'wikidata',
  'IMDb',
  'youtube',
  'youtube music',
])

export type MusicBrainzArtistDetails = {
  officialHomepage: string | null
  twitterUrl: string | null
  instagramUrl: string | null
  links: { type: string; url: string }[]
  genres: string[]
}

export async function fetchArtistDetails(mbid: string): Promise<MusicBrainzArtistDetails> {
  await sleep(1000)
  const url = `${MUSICBRAINZ_BASE}/artist/${mbid}?inc=url-rels+genres&fmt=json`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) {
    throw new Error(`MusicBrainz API error (artist detail): ${res.status}`)
  }
  const data = await res.json()

  let officialHomepage: string | null = null
  let twitterUrl: string | null = null
  let instagramUrl: string | null = null
  const links: { type: string; url: string }[] = []

  for (const rel of data.relations ?? []) {
    const relUrl: string | undefined = rel.url?.resource
    if (!rel.type || !relUrl) continue

    if (rel.type === 'official homepage') {
      officialHomepage = relUrl
      continue
    }

    if (rel.type === 'social network') {
      let host = ''
      try {
        host = new URL(relUrl).hostname
      } catch {
        host = ''
      }
      if (host.includes('twitter.com') || host.includes('x.com')) {
        twitterUrl = relUrl
        continue
      }
      if (host.includes('instagram.com')) {
        instagramUrl = relUrl
        continue
      }
    }

    if (ALLOWED_LINK_TYPES.has(rel.type)) {
      links.push({ type: rel.type, url: relUrl })
    }
  }

  const genres = (data.genres ?? [])
    .map((g: any) => g.name)
    .filter((name: unknown): name is string => Boolean(name))

  return { officialHomepage, twitterUrl, instagramUrl, links, genres }
}
