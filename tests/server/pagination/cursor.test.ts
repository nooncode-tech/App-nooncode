import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeCursor, decodeCursor } from '@/lib/server/pagination/cursor'
import type { CursorPayload } from '@/lib/server/pagination/cursor'

const payload: CursorPayload = {
  createdAt: '2026-05-04T12:00:00Z',
  id: 'abc-123',
}

test('encodeCursor + decodeCursor round-trip returns original payload', () => {
  const token = encodeCursor(payload)
  const decoded = decodeCursor(token)
  assert.deepEqual(decoded, payload)
})

test('decodeCursor returns null for empty string', () => {
  assert.equal(decodeCursor(''), null)
})

test('decodeCursor returns null for non-base64url garbage', () => {
  assert.equal(decodeCursor('!!!not valid!!!'), null)
})

test('decodeCursor returns null for valid base64url but not JSON', () => {
  const token = Buffer.from('not json at all', 'utf-8').toString('base64url')
  assert.equal(decodeCursor(token), null)
})

test('decodeCursor returns null for valid JSON but missing createdAt', () => {
  const token = Buffer.from(JSON.stringify({ id: 'abc' }), 'utf-8').toString('base64url')
  assert.equal(decodeCursor(token), null)
})

test('decodeCursor returns null for valid JSON but missing id', () => {
  const token = Buffer.from(JSON.stringify({ createdAt: '2026-05-04T12:00:00Z' }), 'utf-8').toString('base64url')
  assert.equal(decodeCursor(token), null)
})

test('decodeCursor never throws (try multiple malformed inputs)', () => {
  const inputs = [
    '',
    'garbage',
    '!!!',
    Buffer.from('not json', 'utf-8').toString('base64url'),
    Buffer.from('{}', 'utf-8').toString('base64url'),
    Buffer.from('null', 'utf-8').toString('base64url'),
    Buffer.from('42', 'utf-8').toString('base64url'),
    Buffer.from('[]', 'utf-8').toString('base64url'),
  ]
  for (const input of inputs) {
    assert.doesNotThrow(() => decodeCursor(input))
    assert.equal(decodeCursor(input), null)
  }
})
