// scripts/run-radio-power-play-collect.ts
//
// app/admin/data/media/radio-power-play-collect/CollectButton.tsxが
// ブラウザから行っているoffsetループを、CLIから叩けるようにしたもの
// (管理画面のボタンを押すのと同じAPIルートを、同じやり方で繰り返し呼ぶだけ)。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/run-radio-power-play-collect.ts
import { internalApiBaseUrl } from '@/utils/internalApiBaseUrl'

const BASE_URL = internalApiBaseUrl()

type StationResult = { station: string; extracted: number; inserted: number; error?: string }
type CollectResponse = {
  stations: number
  processed: number
  nextOffset: number | null
  totalInserted: number
  results: StationResult[]
}

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${process.env.BASIC_AUTH_USER}:${process.env.BASIC_AUTH_PASSWORD}`).toString('base64')
}

async function main() {
  let offset = 0
  let processedSoFar = 0
  let total = 0
  let totalInserted = 0

  while (true) {
    const res = await fetch(`${BASE_URL}/api/admin/radio-power-play-collect?offset=${offset}`, {
      method: 'POST',
      headers: { Authorization: authHeader() },
    })
    const body = (await res.json()) as CollectResponse
    if (!res.ok) {
      throw new Error((body as unknown as { error?: string }).error ?? `HTTP ${res.status}`)
    }

    total = body.stations
    processedSoFar += body.processed
    totalInserted += body.totalInserted
    for (const r of body.results) {
      console.log(`[${r.station}] 抽出${r.extracted}件 / 新規${r.inserted}件${r.error ? ` — エラー: ${r.error}` : ''}`)
    }
    console.log(`--- 進捗: ${processedSoFar}/${total}局 ---`)

    if (body.nextOffset === null) break
    offset = body.nextOffset
  }

  console.log(`\n=== 完了 ===`)
  console.log(`${total}局を処理し、新規${totalInserted}件を登録しました。`)
}

main()
