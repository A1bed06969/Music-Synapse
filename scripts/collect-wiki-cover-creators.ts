// scripts/collect-wiki-cover-creators.ts
/**
 * ジャケットの制作者(Hipgnosis、Storm Thorgerson、Peter Saville など、名の知られた人・集団)の Wikipedia の記事から、
 * 手がけたアルバムの一覧を取り出して、カタログのアルバムにクレジット(role='artwork')として入れる。Art Work Museum 用。
 *   記事の「アルバムカバー・作品・ディスコグラフィ」の節 → LLMで {アーティスト, アルバム名} を取り出し →
 *   アーティスト名が完全一致で1人に決まり、アルバム名が(版の違いを除いて)完全一致したものだけ登録する。
 * 無理のない量: 制作者は数十人、1人につきWikipedia 2〜3回とLLM 1回。何度実行しても安全(同じクレジットは作らない)。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/collect-wiki-cover-creators.ts [--only="Hipgnosis"] [--dry-run]
 */
import { Type } from '@google/genai'
import { createAdminClient } from '@/utils/Supabase/admin'
import { AllProvidersExhaustedError, generateJudgementText } from '@/utils/llmJudgeChain'
import { throttledFetch } from '@/utils/wikipediaSync'

const DRY = process.argv.includes('--dry-run')
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.split('=').slice(1).join('=')

// 名前(クレジットに入れる表記) / Wikipediaの記事名 / 言語
const CREATORS: { name: string; title: string; lang: 'en' | 'ja' }[] = [
  { name: 'Hipgnosis', title: 'Hipgnosis', lang: 'en' },
  { name: 'Storm Thorgerson', title: 'Storm Thorgerson', lang: 'en' },
  { name: 'Aubrey Powell', title: 'Aubrey Powell', lang: 'en' },
  { name: 'Peter Saville', title: 'Peter Saville (graphic designer)', lang: 'en' },
  { name: 'Reid Miles', title: 'Reid Miles', lang: 'en' },
  { name: 'Vaughan Oliver', title: 'Vaughan Oliver', lang: 'en' },
  { name: 'Roger Dean', title: 'Roger Dean (artist)', lang: 'en' },
  { name: 'Barney Bubbles', title: 'Barney Bubbles', lang: 'en' },
  { name: 'Alex Steinweiss', title: 'Alex Steinweiss', lang: 'en' },
  { name: 'Jim Flora', title: 'Jim Flora', lang: 'en' },
  { name: 'Mati Klarwein', title: 'Mati Klarwein', lang: 'en' },
  { name: 'Neon Park', title: 'Neon Park', lang: 'en' },
  { name: 'Rick Griffin', title: 'Rick Griffin', lang: 'en' },
  { name: 'Victor Moscoso', title: 'Victor Moscoso', lang: 'en' },
  { name: 'Anton Corbijn', title: 'Anton Corbijn', lang: 'en' },
  { name: 'Brian Duffy', title: 'Brian Duffy (photographer)', lang: 'en' },
  { name: 'Mick Rock', title: 'Mick Rock', lang: 'en' },
  { name: 'Peter Blake', title: 'Peter Blake (artist)', lang: 'en' },
  { name: 'Robert Crumb', title: 'Robert Crumb', lang: 'en' },
  { name: 'H. R. Giger', title: 'H. R. Giger', lang: 'en' },
  { name: '横尾忠則', title: '横尾忠則', lang: 'ja' },
  { name: '宇野亜喜良', title: '宇野亜喜良', lang: 'ja' },
  { name: '空山基', title: '空山基', lang: 'ja' },
  { name: '和田誠', title: '和田誠', lang: 'ja' },
  { name: '鋤田正義', title: '鋤田正義', lang: 'ja' },
  { name: '信藤三雄', title: '信藤三雄', lang: 'ja' },
  { name: '田名網敬一', title: '田名網敬一', lang: 'ja' },
]

const norm = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s*[(\[（][^)\]）]*(remaster|deluxe|edition|expanded|anniversary|version|mono|stereo|リマスター|デラックス|盤)[^)\]）]*[)\]）]/gi, '')
    .replace(/^the\s+/, '')
    .replace(/[\s'’"“”.,!?・&\-_/()[\]:：〜~☆★♪]/g, '')
const q = (o: Record<string, string>) => new URLSearchParams({ format: 'json', ...o }).toString()

async function wikitext(lang: string, title: string): Promise<string> {
  const j = (await throttledFetch(`https://${lang}.wikipedia.org/w/api.php?${q({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1', titles: title })}`)) as {
    query?: { pages: Record<string, { revisions?: { slots: { main: { '*': string } } }[] }> }
  }
  return Object.values(j.query?.pages ?? {})[0]?.revisions?.[0]?.slots.main['*'] ?? ''
}

/** 作品の一覧に当たる節だけを取り出す(長すぎるときは、年号つきの行を優先して切る) */
function worksText(raw: string): string {
  const re = /^(={2,4})\s*([^=\n]+?)\s*\1\s*$/gm
  const heads: { idx: number; level: number; title: string }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) heads.push({ idx: m.index, level: m[1].length, title: m[2] })
  const parts: string[] = []
  for (let k = 0; k < heads.length; k++) {
    if (!/album|cover|discograph|works|design|selected|portfolio|ジャケット|アルバム|作品|ディスコグラフィ|アートワーク|デザイン|仕事/i.test(heads[k].title)) continue
    let end = raw.length
    for (let n = k + 1; n < heads.length; n++) if (heads[n].level <= heads[k].level) { end = heads[n].idx; break }
    parts.push(raw.slice(heads[k].idx, end))
  }
  const text = (parts.length ? parts.join('\n\n') : raw)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/[ \t]+/g, ' ')
  const lines = text.split('\n').filter((l) => /\d{4}|[「『“"]/.test(l) && l.trim().length > 8)
  return lines.join('\n').slice(0, 9000)
}

type Item = { artist_name: string; album_title: string }
const SCHEMA = {
  type: Type.ARRAY,
  items: { type: Type.OBJECT, properties: { artist_name: { type: Type.STRING }, album_title: { type: Type.STRING } }, required: ['artist_name', 'album_title'] },
}
async function extract(creator: string, text: string): Promise<Item[]> {
  const prompt = `以下は、ジャケット(アルバムのカバー)の制作者「${creator}」のWikipediaの記事から、作品の一覧に当たる部分を抜き出した文章です。
この制作者がジャケットを手がけた「アルバム(シングル・EPを含む)」を、すべて取り出してください。

ルール:
- アーティスト名と、アルバム名がはっきり書かれているものだけ。推測しない
- 書籍・ポスター・映画・展覧会など、レコード以外の作品は含めない
- アルバム名は、本文の表記のまま(「」や引用符は付けない)
- 同じアルバムは1回だけ

--- 文章 ---
${text}`
  const out = await generateJudgementText(prompt, SCHEMA)
  try {
    const parsed = JSON.parse(out)
    return Array.isArray(parsed) ? (parsed as Item[]) : []
  } catch {
    return []
  }
}

async function main() {
  const supabase = createAdminClient()
  const targets = CREATORS.filter((c) => !ONLY || c.name === ONLY)
  const total = { creators: 0, extracted: 0, matched: 0, written: 0 }
  for (const c of targets) {
    const raw = await wikitext(c.lang, c.title)
    if (!raw) { console.log(`${c.name}: 記事なし`); continue }
    const text = worksText(raw)
    if (text.length < 40) { console.log(`${c.name}: 作品の一覧なし`); continue }
    let items: Item[] = []
    try {
      items = await extract(c.name, text)
    } catch (e) {
      if (e instanceof AllProvidersExhaustedError) { console.log('LLMの無料枠が尽きたため止めます。'); process.exit(75) }
      console.log(`${c.name}: 抽出失敗`)
      continue
    }
    total.creators++
    total.extracted += items.length
    // クレジットの人物(名前だけ)
    let personId: string | null = null
    if (!DRY) {
      const { data: ex } = await supabase.from('credit_person').select('id').eq('name', c.name).limit(1).maybeSingle()
      personId = (ex?.id as string | undefined) ?? null
      if (!personId) {
        const { data: ins } = await supabase.from('credit_person').insert({ name: c.name }).select('id').single()
        personId = (ins?.id as string | undefined) ?? null
      }
    }
    let matched = 0
    let written = 0
    for (const it of items) {
      if (!it.artist_name?.trim() || !it.album_title?.trim()) continue
      const { data: arts } = await supabase.from('artist').select('id, name').ilike('name', it.artist_name.trim().replace(/[\\%_]/g, (m) => `\\${m}`)).limit(5)
      const exact = (arts ?? []).filter((a) => norm(a.name as string) === norm(it.artist_name))
      if (exact.length !== 1) continue
      const { data: albums } = await supabase.from('album').select('id, title').eq('artist_id', exact[0].id).limit(2000)
      const hits = (albums ?? []).filter((a) => norm(a.title as string) === norm(it.album_title))
      if (!hits.length) continue
      matched++
      if (DRY) { console.log(`  ${c.name}: ${it.artist_name}『${it.album_title}』 → カタログ ${hits.length}枚`); continue }
      for (const a of hits) {
        const { data: dup } = await supabase.from('artist_credit').select('id').eq('album_id', a.id).eq('credit_person_id', personId!).eq('role', 'artwork').limit(1)
        if (dup?.length) continue
        const { error } = await supabase.from('artist_credit').insert({
          artist_id: exact[0].id, album_id: a.id, track_id: null, credit_person_id: personId, role: 'artwork', source: 'wikipedia',
          source_url: `https://${c.lang}.wikipedia.org/wiki/${encodeURIComponent(c.title.replace(/ /g, '_'))}`,
        })
        if (!error) written++
      }
    }
    total.matched += matched
    total.written += written
    console.log(`${c.name}: 抽出 ${items.length}件 / カタログで確定 ${matched}件 / 登録 ${written}件`)
  }
  console.log(`=== 終了${DRY ? '(dry-run)' : ''} === ${JSON.stringify(total)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
