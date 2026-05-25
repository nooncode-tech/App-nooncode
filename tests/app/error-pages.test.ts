import assert from 'node:assert/strict'
import test from 'node:test'

// Smoke tests for the framework-level error / not-found / loading / global-error
// pages introduced in B18. The contract is minimal: each file must export a
// default React component (a function). Visual / behavioral validation is
// browser-level, documented under docs/validations/.

test('app/not-found.tsx exports a default React component', async () => {
  const mod = await import('../../app/not-found')
  assert.equal(typeof mod.default, 'function', 'default export must be a function')
})

test('app/error.tsx exports a default React component', async () => {
  const mod = await import('../../app/error')
  assert.equal(typeof mod.default, 'function', 'default export must be a function')
})

test('app/loading.tsx exports a default React component', async () => {
  const mod = await import('../../app/loading')
  assert.equal(typeof mod.default, 'function', 'default export must be a function')
})

test('app/global-error.tsx exports a default React component', async () => {
  const mod = await import('../../app/global-error')
  assert.equal(typeof mod.default, 'function', 'default export must be a function')
})
