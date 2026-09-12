// __tests__/fk-repoint.unit.test.ts
//
// 「指定した外部キー列一覧それぞれについてUPDATEを試み、失敗したものは
// 個別に記録して残りは続行する」というオーケストレーションロジックのテスト。
// 実際のDB呼び出しはupdateFnとして注入するため、ここではDBに触れない。
//
// 実行: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { repointForeignKeys, type FkReference } from '../utils/fkRepoint.ts'

describe('repointForeignKeys', () => {
  test('calls updateFn once per reference and reports ok with the moved count when it succeeds', async () => {
    const refs: FkReference[] = [{ table: 'track_artist', column: 'artist_id' }]
    const calls: unknown[] = []
    const result = await repointForeignKeys(refs, 'dup-1', 'canon-1', async (table, column, fromId, toId) => {
      calls.push({ table, column, fromId, toId })
      return { error: null, count: 3 }
    })
    assert.deepEqual(result, [{ table: 'track_artist', column: 'artist_id', status: 'ok', movedCount: 3 }])
    assert.deepEqual(calls, [{ table: 'track_artist', column: 'artist_id', fromId: 'dup-1', toId: 'canon-1' }])
  })

  test('defaults movedCount to 0 when updateFn does not report a count', async () => {
    const refs: FkReference[] = [{ table: 'track_artist', column: 'artist_id' }]
    const result = await repointForeignKeys(refs, 'dup-1', 'canon-1', async () => ({ error: null }))
    assert.deepEqual(result, [{ table: 'track_artist', column: 'artist_id', status: 'ok', movedCount: 0 }])
  })

  test('records a failure for one reference without stopping the rest', async () => {
    const refs: FkReference[] = [
      { table: 'genre_highlight', column: 'artist_id' },
      { table: 'track_artist', column: 'artist_id' },
    ]
    const result = await repointForeignKeys(refs, 'dup-1', 'canon-1', async (table) => {
      if (table === 'genre_highlight') return { error: 'duplicate key value violates unique constraint' }
      return { error: null, count: 2 }
    })
    assert.deepEqual(result, [
      { table: 'genre_highlight', column: 'artist_id', status: 'failed', error: 'duplicate key value violates unique constraint' },
      { table: 'track_artist', column: 'artist_id', status: 'ok', movedCount: 2 },
    ])
  })

  test('returns an empty array for an empty reference list', async () => {
    const result = await repointForeignKeys([], 'dup-1', 'canon-1', async () => ({ error: null }))
    assert.deepEqual(result, [])
  })
})
