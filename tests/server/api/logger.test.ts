import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeLogContext } from '@/lib/server/api/logger'

test('sanitizeLogContext redacts sensitive keys recursively', () => {
  const sanitized = sanitizeLogContext({
    requestId: 'req_123',
    authorization: 'Bearer secret',
    nested: {
      stripeSignature: 'sig_secret',
      safe: 'value',
    },
  })

  assert.deepEqual(sanitized, {
    requestId: 'req_123',
    authorization: '[redacted]',
    nested: {
      stripeSignature: '[redacted]',
      safe: 'value',
    },
  })
})

test('sanitizeLogContext truncates long strings', () => {
  const sanitized = sanitizeLogContext({
    body: 'a'.repeat(600),
  })

  assert.equal(typeof sanitized.body, 'string')
  assert.equal((sanitized.body as string).length, 503)
})
