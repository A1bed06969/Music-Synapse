// scripts/localize-event-images.ts
/**
 * event.image_url が外部サイトの画像(OGP画像など)のものを、自サイト(public/images/events/)に保存して、
 * image_url を自サイトのパスに差し替える。外部の画像は、スマホで読み込めないことがあるため(Fender NEXT で確認済み)。
 * 幅1200pxのJPEGにそろえる。保存できなかったものは、元のURLのまま残して報告する。何度実行しても安全。
 *
 * 実行方法:
 *   npx tsx --env-file=.env.local scripts/localize-event-images.ts
 */
import { mkdirSync, writeFileSync } from 'fs'
import sharp from 'sharp'
import { createAdminClient } from '@/utils/Supabase/admin'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

async function main() {
  const supabase = createAdminClient()
  mkdirSync('public/images/events', { recursive: true })
  const { data: events } = await supabase.from('event').select('id, name, image_url').not('image_url', 'is', null)
  let done = 0, skipped = 0
  for (const e of events ?? []) {
    if (!e.image_url || e.image_url.startsWith('/')) {
      skipped++
      continue
    }
    try {
      const res = await fetch(e.image_url, { headers: { 'User-Agent': UA, Referer: new URL(e.image_url).origin + '/' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const jpg = await sharp(buf).resize({ width: 1200, withoutEnlargement: true }).flatten({ background: '#111111' }).jpeg({ quality: 82, progressive: true }).toBuffer()
      const path = `/images/events/${e.id}.jpg`
      writeFileSync(`public${path}`, jpg)
      const { error } = await supabase.from('event').update({ image_url: path }).eq('id', e.id)
      if (error) throw new Error(error.message)
      done++
      console.log(`保存: ${e.name} (${Math.round(jpg.length / 1024)}KB)`)
    } catch (err) {
      console.log(`失敗(元のURLのまま): ${e.name} — ${(err as Error).message}`)
    }
  }
  console.log(`\n保存 ${done}件 / 既に自サイト ${skipped}件`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
