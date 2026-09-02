// __tests__/radio-power-play-collect.integration.test.ts
//
// ラジオPP自動収集APIルートの結合テスト。実際のGemini/iTunes呼び出しを含む
// (モックしない、このプロジェクトの既存結合テストと同じ方針)。
// 前提: dev server (`npm run dev`) が起動していること。起動していない場合は
// failではなくskipする。サイト全体がBasic認証配下にあるためAuthorization
// ヘッダを付ける(__tests__/disc-guide-import.integration.test.tsと同じ
// パターン)。GEMINI_API_KEYが.env.localに必要。
//
// このテストは実際にradio_airplay_pickへ行をinsertするため、作成した行を
// after()で必ず削除する(disc-guide-import.integration.test.tsと同じ方針。
// npm testを何度実行しても本番データを汚さないようにする)。
//
// 実行: npm test

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createAdminClient } from '../utils/Supabase/admin.ts'

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3000'

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const user = process.env.BASIC_AUTH_USER ?? ''
  const pass = process.env.BASIC_AUTH_PASSWORD ?? ''
  const token = Buffer.from(`${user}:${pass}`).toString('base64')
  return { Authorization: `Basic ${token}`, ...extra }
}

async function isServerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/admin/data/media/radio-power-play-collect`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(5000),
    })
    return res.status !== 404
  } catch {
    return false
  }
}

describe('POST /api/admin/radio-power-play-collect', () => {
  const supabase = createAdminClient()
  const createdPickIds: string[] = []

  after(async () => {
    if (createdPickIds.length > 0) {
      await supabase.from('radio_airplay_pick').delete().in('id', createdPickIds)
    }
  })

  test('rejects requests without Basic auth (site-wide proxy.ts still protects this route)', async (t) => {
    if (!(await isServerUp())) return t.skip('dev server not running')

    const res = await fetch(`${BASE_URL}/api/admin/radio-power-play-collect`, { method: 'POST' })
    assert.equal(res.status, 401)
  })

  test('runs the collection for seeded pilot stations with valid Basic auth', async (t) => {
    if (!(await isServerUp())) return t.skip('dev server not running')
    if (!process.env.GEMINI_API_KEY) return t.skip('GEMINI_API_KEY not set')

    const beforeTimestamp = new Date().toISOString()

    const res = await fetch(`${BASE_URL}/api/admin/radio-power-play-collect`, {
      method: 'POST',
      headers: authHeaders(),
    })
    const text = await res.text()
    assert.equal(res.status, 200, text)
    const body = JSON.parse(text)

    // このテスト実行でinsertされた行をafter()で消せるよう、直後のタイムスタンプで
    // 絞り込んで拾っておく(dedupロジックがある関係で0件insertの可能性もある)
    const { data: createdRows } = await supabase
      .from('radio_airplay_pick')
      .select('id')
      .gte('created_at', beforeTimestamp)
    if (createdRows) {
      createdPickIds.push(...createdRows.map((r) => r.id))
    }

    assert.ok(body.stations >= 3, `expected at least the 3 seeded pilot stations, got ${body.stations}`)
    const stationNames = body.results.map((r: { station: string }) => r.station)
    assert.ok(stationNames.includes('FM福井'), 'expected FM福井 to be among the processed stations')

    const fmFukui = body.results.find((r: { station: string }) => r.station === 'FM福井')
    assert.equal(fmFukui.error, undefined, `FM福井 extraction should not error: ${fmFukui.error}`)
  })
})
