import assert from 'node:assert/strict'
import test from 'node:test'

// Smoke import for the mobile drawer chrome introduced in G21 (mobile
// responsive fix iteration). The project does not have React component
// testing infrastructure (no jsdom / RTL / Vitest — see B18 precedent
// at tests/app/error-pages.test.ts). The contract here is the same:
// the module must export a named React component (a function). Visual
// and interaction validation (drawer opens at <768, auto-closes on
// navigation, no horizontal scroll) is browser-level evidence under
// docs/validations/.

test('components/dashboard-mobile-header.tsx exports DashboardMobileHeader as a function', async () => {
  const mod = await import('../../components/dashboard-mobile-header')
  assert.equal(
    typeof mod.DashboardMobileHeader,
    'function',
    'DashboardMobileHeader named export must be a function (React component)'
  )
})
