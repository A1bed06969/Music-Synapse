import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseGeminiBioResponse } from '../utils/geminiBioGenerate.ts'

describe('parseGeminiBioResponse', () => {
  test('parses a GENERATED response with bio text', () => {
    const text = JSON.stringify({ status: 'GENERATED', bio: '岡山県出身のシンガーソングライター。' })
    assert.deepEqual(parseGeminiBioResponse(text), { status: 'generated', bio: '岡山県出身のシンガーソングライター。' })
  })

  test('trims whitespace from bio', () => {
    const text = JSON.stringify({ status: 'GENERATED', bio: '  余白付きの紹介文  ' })
    assert.deepEqual(parseGeminiBioResponse(text), { status: 'generated', bio: '余白付きの紹介文' })
  })

  test('returns declined for INSUFFICIENT status', () => {
    const text = JSON.stringify({ status: 'INSUFFICIENT' })
    assert.deepEqual(parseGeminiBioResponse(text), { status: 'declined' })
  })

  test('returns declined when bio is an empty/whitespace-only string', () => {
    const text = JSON.stringify({ status: 'GENERATED', bio: '   ' })
    assert.deepEqual(parseGeminiBioResponse(text), { status: 'declined' })
  })

  test('returns declined for invalid JSON', () => {
    assert.deepEqual(parseGeminiBioResponse('not json'), { status: 'declined' })
  })
})
