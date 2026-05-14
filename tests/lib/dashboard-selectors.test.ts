import assert from 'node:assert/strict'
import test from 'node:test'
import { selectPersonalStatsAvailability } from '@/lib/dashboard-selectors'
import type { User } from '@/lib/types'
import type { WalletContextValue } from '@/lib/wallet/context'

// Minimal User stub. The selector only reads .balance and .points, so the
// rest of the User shape is irrelevant for these tests.
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    name: 'Test User',
    email: 'test@noon.app',
    role: 'sales',
    avatar: '',
    isActive: true,
    balance: 0,
    points: 0,
    ...overrides,
  } as User
}

function makeWalletState(
  override: Partial<WalletContextValue> | undefined
): WalletContextValue | undefined {
  return override as WalletContextValue | undefined
}

test('mock mode: balance + points come from user.balance / user.points (regression net)', () => {
  const user = makeUser({ balance: 1500, points: 320 })

  const stats = selectPersonalStatsAvailability('mock', user)

  // The mock branch uses .toLocaleString() with the runtime's default locale.
  // Compute expected the same way so the test is locale-agnostic.
  const expectedBalance = `$${(1500).toLocaleString()}`
  const expectedPoints = (320).toLocaleString()

  assert.equal(stats.isRealDataAvailable, true)
  assert.equal(stats.balanceValueLabel, expectedBalance)
  assert.equal(stats.pointsValueLabel, expectedPoints)
  assert.equal(stats.sidebarBalanceLabel, `Balance: ${expectedBalance}`)
  assert.equal(stats.sidebarPointsLabel, `Puntos: ${expectedPoints}`)
  assert.equal(stats.earningsActionLabel, 'Solicitar Retiro')
  assert.equal(stats.rewardsActionLabel, 'Canjear')
})

test('mock mode: wallet argument is ignored — mock branch is unchanged', () => {
  const user = makeUser({ balance: 50, points: 10 })
  const expectedBalance = `$${(50).toLocaleString()}`

  // Even if a wallet snapshot is passed, mock branch must keep its own behavior.
  const stats = selectPersonalStatsAvailability('mock', user, makeWalletState({
    status: 'loaded',
    wallet: { monetaryWallet: { availableToSpend: 99999, availableToWithdraw: 0, pending: 0, locked: 0, currency: 'USD' } } as never,
    error: null,
  }))

  assert.equal(stats.balanceValueLabel, expectedBalance)
  assert.equal(stats.sidebarBalanceLabel, `Balance: ${expectedBalance}`)
})

test('supabase + loaded: balance is the USD sum of availableToSpend + availableToWithdraw', () => {
  const user = makeUser({ role: 'admin' })

  const stats = selectPersonalStatsAvailability('supabase', user, makeWalletState({
    status: 'loaded',
    wallet: {
      freeAvailable: 0,
      earnedAvailable: 0,
      totalAvailable: 0,
      entries: [],
      monetaryWallet: {
        availableToSpend: 120,
        availableToWithdraw: 80,
        pending: 50,
        locked: 0,
        currency: 'USD',
      },
    } as never,
    error: null,
  }))

  // 120 + 80 = 200; pending and locked are NOT included.
  assert.equal(stats.isRealDataAvailable, true)
  assert.equal(stats.balanceValueLabel, '$200')
  assert.equal(stats.sidebarBalanceLabel, 'Balance: $200')
  assert.equal(stats.earningsTitle, 'Ganancias')
  assert.equal(stats.earningsActionLabel, 'Solicitar Retiro')
})

test('supabase + loaded + no monetaryWallet: balance falls back to $0 without crashing', () => {
  const user = makeUser({ role: 'admin' })

  const stats = selectPersonalStatsAvailability('supabase', user, makeWalletState({
    status: 'loaded',
    wallet: {
      freeAvailable: 0,
      earnedAvailable: 0,
      totalAvailable: 0,
      entries: [],
      // monetaryWallet intentionally absent — migration 0024 not applied locally
    } as never,
    error: null,
  }))

  assert.equal(stats.balanceValueLabel, '$0')
  assert.equal(stats.sidebarBalanceLabel, 'Balance: $0')
})

test('supabase + loading: balance shows "cargando", never "no disponible"', () => {
  const user = makeUser({ role: 'admin' })

  const stats = selectPersonalStatsAvailability('supabase', user, makeWalletState({
    status: 'loading',
    wallet: null,
    error: null,
  }))

  assert.equal(stats.isRealDataAvailable, false)
  assert.equal(stats.balanceValueLabel, 'Cargando…')
  assert.equal(stats.sidebarBalanceLabel, 'Balance: cargando…')
  // Earnings action stays positive — once load completes the user will be able
  // to act on real data; the loading state is transient.
  assert.equal(stats.earningsActionLabel, 'Solicitar Retiro')
})

test('supabase + idle (no provider mounted): same as loading', () => {
  const user = makeUser({ role: 'admin' })

  // walletState omitted — selector defaults to idle, which renders as loading.
  const stats = selectPersonalStatsAvailability('supabase', user)

  assert.equal(stats.balanceValueLabel, 'Cargando…')
  assert.equal(stats.sidebarBalanceLabel, 'Balance: cargando…')
})

test('supabase + error: balance shows "no se pudo cargar"', () => {
  const user = makeUser({ role: 'admin' })

  const stats = selectPersonalStatsAvailability('supabase', user, makeWalletState({
    status: 'error',
    wallet: null,
    error: new Error('Network failure'),
  }))

  assert.equal(stats.isRealDataAvailable, false)
  assert.equal(stats.balanceValueLabel, 'No se pudo cargar')
  assert.equal(stats.sidebarBalanceLabel, 'Balance: no se pudo cargar')
  assert.equal(stats.earningsActionLabel, 'Reintentar')
})

test('supabase: rewards / points stay honest-unavailable regardless of wallet state', () => {
  const user = makeUser({ role: 'sales' })

  for (const status of ['loaded', 'loading', 'error', 'idle'] as const) {
    const walletState =
      status === 'idle'
        ? undefined
        : makeWalletState({
            status: status as Exclude<WalletContextValue['status'], 'idle'>,
            wallet:
              status === 'loaded'
                ? ({
                    freeAvailable: 0,
                    earnedAvailable: 0,
                    totalAvailable: 0,
                    entries: [],
                    monetaryWallet: {
                      availableToSpend: 10,
                      availableToWithdraw: 0,
                      pending: 0,
                      locked: 0,
                      currency: 'USD',
                    },
                  } as never)
                : null,
            error: status === 'error' ? new Error('boom') : null,
          } as never)

    const stats = selectPersonalStatsAvailability('supabase', user, walletState)

    assert.equal(
      stats.pointsValueLabel,
      'Sin programa real',
      `points label should stay honest in status=${status}`
    )
    assert.equal(
      stats.sidebarPointsLabel,
      'Puntos: sin fuente real',
      `sidebar points label should stay honest in status=${status}`
    )
    assert.equal(
      stats.rewardsTitle,
      'Rewards no conectadas',
      `rewards title should stay honest in status=${status}`
    )
    assert.equal(
      stats.rewardsActionLabel,
      'Canje no disponible',
      `rewards action should stay honest in status=${status}`
    )
  }
})
