import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveWebsitePrototypeReference } from '@/lib/server/prototypes/website-inbound'

test('resolveWebsitePrototypeReference prefers prototype_url', () => {
  const reference = resolveWebsitePrototypeReference({
    prototype_url: 'https://v0.dev/demo/abc',
    prototype_versions: [{ url: 'https://v0.dev/demo/fallback' }],
  })

  assert.equal(reference, 'https://v0.dev/demo/abc')
})

test('resolveWebsitePrototypeReference falls back to first version url', () => {
  const reference = resolveWebsitePrototypeReference({
    prototype_url: null,
    prototype_versions: [{ url: 'https://v0.dev/demo/version-1' }],
  })

  assert.equal(reference, 'https://v0.dev/demo/version-1')
})

test('resolveWebsitePrototypeReference returns null when no prototype exists', () => {
  const reference = resolveWebsitePrototypeReference({
    prototype_url: null,
    prototype_versions: [],
  })

  assert.equal(reference, null)
})
