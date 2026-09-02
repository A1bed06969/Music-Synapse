import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { isRateLimitError } from '../utils/radioPickMatching.ts'

describe('isRateLimitError', () => {
  test('detects 403 in error message', () => {
    assert.equal(isRateLimitError(new Error('iTunes fetch failed: 403 Forbidden')), true)
  })

  test('detects 429 in error message', () => {
    assert.equal(isRateLimitError(new Error('too many requests (429)')), true)
  })

  test('returns false for unrelated errors', () => {
    assert.equal(isRateLimitError(new Error('network timeout')), false)
  })

  test('handles non-Error values', () => {
    assert.equal(isRateLimitError('plain string 429'), true)
    assert.equal(isRateLimitError({ weird: 'object' }), false)
  })
})
