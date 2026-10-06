// ローカルdevサーバーのAPIを叩くスクリプト用のfetch。next devはメモリ上限に近づくと
// 自動再起動し、その数十秒間は接続自体が失敗する。待たずに次の件へ進むと残り全件が
// 一瞬で「fetch failed」になるため、接続エラーの間は待って同じリクエストをやり直す。
const RETRY_WAIT_MS = 15_000
const MAX_WAIT_MS = 10 * 60_000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchDevServer(url: string, init: RequestInit): Promise<Response> {
  const startedAt = Date.now()
  while (true) {
    try {
      return await fetch(url, init)
    } catch (err) {
      if (Date.now() - startedAt > MAX_WAIT_MS) throw err
      console.error(`  devサーバーに接続できません(${(err as Error).message})。${RETRY_WAIT_MS / 1000}秒後に再試行します`)
      await sleep(RETRY_WAIT_MS)
    }
  }
}
