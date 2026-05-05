import assert from 'node:assert/strict'
import test from 'node:test'
import {
  maxwellLeadSearchRequestSchema,
  parseMaxwellFeedbackInput,
  radiusKmForConfirmedSales,
} from '@/lib/server/maxwell/lead-engine'

test('Maxwell radius increases with confirmed sales thresholds', () => {
  assert.equal(radiusKmForConfirmedSales(0), 5)
  assert.equal(radiusKmForConfirmedSales(3), 10)
  assert.equal(radiusKmForConfirmedSales(8), 20)
  assert.equal(radiusKmForConfirmedSales(16), 35)
  assert.equal(radiusKmForConfirmedSales(31), 50)
})

test('Maxwell lead search schema validates current location coordinates', () => {
  const parsed = maxwellLeadSearchRequestSchema.parse({
    mode: 'current_location',
    latitude: 18.4861,
    longitude: -69.9312,
    locale: 'es-DO',
  })

  assert.equal(parsed.mode, 'current_location')
})

test('Maxwell lead search schema rejects invalid coordinates', () => {
  assert.throws(() => maxwellLeadSearchRequestSchema.parse({
    mode: 'current_location',
    latitude: 180,
    longitude: -69.9312,
  }))
})

test('Maxwell feedback schema rejects unsupported ratings', () => {
  assert.throws(() => parseMaxwellFeedbackInput({
    rating: 'perfect',
  }))
})
