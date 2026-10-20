// TOPページの④Music Planet Tour・⑤Clip Disc-Guide・⑥Media Curation Express のバナー用データ。
// TOPは毎回描画されるので、どれも件数を絞った軽い問い合わせにしている。
// 並びは「その日(JST)ごとに入れ替わる」ようにし、同じ日のうちは同じ並びを保つ。
import type { createClient } from '@/utils/Supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/** JSTの日付から決まる乱数(同じ日は同じ並びになる) */
function dailyRandom(): () => number {
  const day = Number(new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, ''))
  let seed = day % 2147483647
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647
}

function pickDaily<T>(items: T[], count: number): T[] {
  const rnd = dailyRandom()
  const pool = [...items]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, count)
}

import { originLabel } from '@/utils/originPlace'

// ---------- ④ Music Planet Tour ----------

import { PLANET_AREA_LABEL, type PlanetArea } from '@/utils/planetAreas'

const PLANET_AREAS = Object.keys(PLANET_AREA_LABEL) as PlanetArea[]
export type { PlanetArea }

export type PlanetArtistCard = {
  id: string
  name: string
  imageUrl: string
  place: string
  countryCode: string
  area: PlanetArea
  lat: number
  lon: number
}
export type PlanetData = { artists: PlanetArtistCard[]; total: number }

/** 国コード → エリア(地図データ public/geo/world-compact.json の大陸・地域から作る。起動後1回だけ読む) */
let areaCodesCache: Record<PlanetArea, string[]> | null = null
function areaCodes(): Record<PlanetArea, string[]> {
  if (areaCodesCache) return areaCodesCache
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  const world = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/geo/world-compact.json'), 'utf8')) as {
    features: { properties: { code: string; continent: string; subregion: string } }[]
  }
  const out = Object.fromEntries(PLANET_AREAS.map((a) => [a, [] as string[]])) as Record<PlanetArea, string[]>
  for (const { properties: p } of world.features) {
    if (!/^[a-z]{2}$/.test(p.code)) continue
    const area: PlanetArea | null =
      p.code === 'jp' ? 'japan'
      : p.continent === 'Asia' ? 'asia'
      : p.continent === 'Europe' ? 'europe'
      : p.continent === 'North America' ? (p.subregion === 'Northern America' ? 'northAmerica' : 'latinAmerica')
      : p.continent === 'South America' ? 'latinAmerica'
      : p.continent === 'Africa' ? 'africa'
      : p.continent === 'Oceania' ? 'oceania'
      : null
    if (area) out[area].push(p.code)
  }
  // 小さな国・地域(地図データに無いもの)を補う
  out.asia.push('sg', 'hk', 'mo', 'bh', 'mv')
  out.latinAmerica.push('bb', 'tt', 'lc', 'gd', 'vc', 'ag', 'kn', 'dm')
  out.europe.push('mt', 'lu', 'ad', 'mc', 'li', 'sm', 'is')
  areaCodesCache = out
  return out
}

/** エリアごとに、出身地の座標と Apple の写真があるアーティストから、その日の代表1組 */
export async function fetchPlanetArtists(supabase: Supabase): Promise<PlanetData> {
  const codes = areaCodes()
  const [{ count: total }, ...perArea] = await Promise.all([
    // 「◯組の出身地」は、地球儀に実際に置ける(座標がある)人数。国コードだけ入っている人数だと、実際より少なく出ていた
    supabase.from('artist').select('id', { count: 'exact', head: true }).not('origin_latitude', 'is', null),
    ...PLANET_AREAS.map((area) =>
      supabase
        .from('artist')
        .select('id, name, image_url, origin_country_code, origin_muni_code, origin_region_code, origin_latitude, origin_longitude')
        .in('origin_country_code', codes[area])
        .not('origin_latitude', 'is', null)
        .like('image_url', 'https://is%-ssl.mzstatic.com/%')
        .order('updated_at', { ascending: false })
        .limit(80),
    ),
  ])
  const artists: PlanetArtistCard[] = []
  perArea.forEach(({ data }, i) => {
    const [a] = pickDaily(data ?? [], 1)
    if (!a) return
    artists.push({
      id: a.id,
      name: a.name,
      imageUrl: a.image_url,
      countryCode: a.origin_country_code,
      place: originLabel(a.origin_country_code, a.origin_muni_code, a.origin_region_code),
      area: PLANET_AREAS[i],
      lat: a.origin_latitude,
      lon: a.origin_longitude,
    })
  })
  return { artists, total: total ?? 0 }
}

// ---------- ⑤ Clip Disc-Guide ----------

export type DiscGuideBookCard = {
  id: string
  title: string
  coverUrl: string | null
  publisher: string | null
  year: number | null
  albumCount: number
  /** 表紙画像が無い本の、代わりに見せる掲載盤のジャケット(最大4枚) */
  jackets: string[]
}

/** ディスクガイド(本)の一覧。掲載枚数の多い順 */
export async function fetchDiscGuideBooks(supabase: Supabase): Promise<DiscGuideBookCard[]> {
  const { data: guides } = await supabase.from('disc_guide').select('id, title, cover_image_url, publisher, published_year')
  const books = await Promise.all(
    (guides ?? []).map(async (g) => {
      const { data, count } = await supabase
        .from('disc_guide_selection')
        .select('album:album_id(jacket_url)', { count: 'exact' })
        .eq('disc_guide_id', g.id)
        .limit(40)
      const jackets = (data ?? []).map((s) => firstOf(s.album)?.jacket_url).filter((u): u is string => !!u)
      return {
        id: g.id as string,
        title: g.title as string,
        coverUrl: (g.cover_image_url as string | null) ?? null,
        publisher: (g.publisher as string | null) ?? null,
        year: (g.published_year as number | null) ?? null,
        albumCount: count ?? 0,
        jackets: pickDaily(jackets, 4),
      }
    }),
  )
  return books.sort((a, b) => b.albumCount - a.albumCount)
}

// ---------- ⑥ Media Curation Express ----------

export type CurationCard = {
  id: string
  name: string
  mediaName: string
  entryCount: number
  /** 企画のメインビジュアル(登録されていれば) */
  visualUrl: string | null
  /** メインビジュアルが無いときに並べる、選出作品の画像(最大4枚) */
  images: string[]
}

/** キュレーション(ranking)ごとに、メインビジュアル・件数・代表の画像 */
export async function fetchCurations(supabase: Supabase, limit: number): Promise<CurationCard[]> {
  const { data: rankings } = await supabase
    .from('ranking')
    .select('id, name, source, image_url, media:media_id(name)')
    .order('id', { ascending: false })
    .limit(limit)
  return Promise.all(
    (rankings ?? []).map(async (r) => {
      const { data: entries, count } = await supabase
        .from('ranking_entry')
        .select('artist:artist_id(image_url), album:album_id(jacket_url)', { count: 'exact' })
        .eq('ranking_id', r.id)
        .limit(40)
      const images = (entries ?? [])
        .map((e) => firstOf(e.album)?.jacket_url ?? firstOf(e.artist)?.image_url ?? null)
        .filter((u): u is string => !!u && /mzstatic\.com/.test(u))
      // 自サイトに保存した画像(/images/...)も使う。一覧カード用アイコン(/curation/...)は横長枠に不向きなので除く
      const visual = typeof r.image_url === 'string' && /^(https:\/\/|\/images\/)/.test(r.image_url) ? r.image_url : null
      return {
        id: r.id as string,
        name: r.name as string,
        mediaName: firstOf(r.media)?.name ?? r.source ?? '',
        entryCount: count ?? 0,
        visualUrl: visual,
        images: pickDaily(images, 4),
      }
    }),
  )
}
