import assert from 'node:assert/strict'
import test from 'node:test'
import { maxwellChatRequestSchema } from '@/lib/server/maxwell/chat-schema'

test('maxwell chat schema accepts a bounded valid message payload', () => {
  const parsed = maxwellChatRequestSchema.parse({
    messages: [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'Ayudame con este lead' }],
      },
    ],
    leadId: '11111111-1111-4111-8111-111111111111',
    channel: 'lead-detail',
  })

  assert.equal(parsed.messages.length, 1)
  assert.equal(parsed.channel, 'lead-detail')
})

test('maxwell chat schema rejects empty messages', () => {
  assert.throws(() => maxwellChatRequestSchema.parse({ messages: [] }))
})

test('maxwell chat schema rejects malformed lead ids', () => {
  assert.throws(() => maxwellChatRequestSchema.parse({
    messages: [{ role: 'user', content: 'hola' }],
    leadId: 'not-a-uuid',
  }))
})
