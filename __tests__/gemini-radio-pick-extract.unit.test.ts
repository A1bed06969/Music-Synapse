import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseRadioPickResponse } from '../utils/geminiRadioPickExtract.ts'

describe('parseRadioPickResponse', () => {
  test('parses a valid JSON array with campaignName', () => {
    const text = JSON.stringify([
      { artistName: 'Official髭男dism', trackTitle: 'Subtitle', campaignName: 'パワープレイ' },
    ])
    const result = parseRadioPickResponse(text)
    assert.deepEqual(result, [
      { artistName: 'Official髭男dism', trackTitle: 'Subtitle', campaignName: 'パワープレイ' },
    ])
  })

  test('defaults campaignName to null when missing', () => {
    const text = JSON.stringify([{ artistName: 'Foo', trackTitle: 'Bar' }])
    const result = parseRadioPickResponse(text)
    assert.deepEqual(result, [{ artistName: 'Foo', trackTitle: 'Bar', campaignName: null }])
  })

  test('drops entries missing required fields', () => {
    const text = JSON.stringify([
      { artistName: 'OnlyArtist' },
      { trackTitle: 'OnlyTrack' },
      { artistName: 'Complete', trackTitle: 'Entry' },
    ])
    const result = parseRadioPickResponse(text)
    assert.deepEqual(result, [{ artistName: 'Complete', trackTitle: 'Entry', campaignName: null }])
  })

  test('trims whitespace', () => {
    const text = JSON.stringify([{ artistName: '  Spacey  ', trackTitle: '  Title  ', campaignName: '  Camp  ' }])
    const result = parseRadioPickResponse(text)
    assert.deepEqual(result, [{ artistName: 'Spacey', trackTitle: 'Title', campaignName: 'Camp' }])
  })

  test('returns empty array for invalid JSON', () => {
    assert.deepEqual(parseRadioPickResponse('not json'), [])
  })

  test('returns empty array for a non-array JSON value', () => {
    assert.deepEqual(parseRadioPickResponse('{"artistName":"x"}'), [])
  })
})
