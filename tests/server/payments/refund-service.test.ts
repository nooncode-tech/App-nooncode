import assert from 'node:assert/strict'
import test from 'node:test'

import { triggerRefund } from '@/lib/server/payments/refund-service'
import { ApiError, ConflictApiError, NotFoundApiError } from '@/lib/server/api/errors'

// ---------------------------------------------------------------------------
// Mock supabase client — only the .from('payments').select(...).eq().maybeSingle()
// chain is exercised here. The Stripe SDK is never reached because each test
// short-circuits with a guard error before the SDK call. That's the point:
// these tests cover the validation surface of triggerRefund without needing
// to mock the Stripe module.
// ---------------------------------------------------------------------------

type MockResult = { data: unknown | null; error: { message: string } | null }

function makeMockClient(paymentLookupResult: MockResult) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve(paymentLookupResult),
  }

  return {
    from: () => chain,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('triggerRefund throws NotFoundApiError when payment row is missing', async () => {
  const client = makeMockClient({ data: null, error: null })

  await assert.rejects(
    triggerRefund(client as never, {
      paymentId: '00000000-0000-0000-0000-000000000000',
      actorProfileId: '00000000-0000-0000-0000-00000000aaaa',
    }),
    (err: unknown) => {
      assert.ok(err instanceof NotFoundApiError, 'expected NotFoundApiError')
      return true
    }
  )
})

test('triggerRefund throws ConflictApiError when payment is already refunded', async () => {
  const client = makeMockClient({
    data: {
      id: '11111111-1111-1111-1111-111111111111',
      status: 'refunded',
      stripe_payment_intent_id: 'pi_live_abc',
      amount: 100,
    },
    error: null,
  })

  await assert.rejects(
    triggerRefund(client as never, {
      paymentId: '11111111-1111-1111-1111-111111111111',
      actorProfileId: '00000000-0000-0000-0000-00000000aaaa',
    }),
    (err: unknown) => {
      assert.ok(err instanceof ConflictApiError, 'expected ConflictApiError')
      assert.equal(
        (err as ConflictApiError).code,
        'PAYMENT_ALREADY_REFUNDED',
        'expected PAYMENT_ALREADY_REFUNDED code'
      )
      return true
    }
  )
})

test('triggerRefund throws PAYMENT_NOT_REFUNDABLE when payment status is not succeeded', async () => {
  for (const status of ['pending', 'failed', 'processing']) {
    const client = makeMockClient({
      data: {
        id: '22222222-2222-2222-2222-222222222222',
        status,
        stripe_payment_intent_id: 'pi_live_abc',
        amount: 100,
      },
      error: null,
    })

    await assert.rejects(
      triggerRefund(client as never, {
        paymentId: '22222222-2222-2222-2222-222222222222',
        actorProfileId: '00000000-0000-0000-0000-00000000aaaa',
      }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError, `expected ApiError for status='${status}'`)
        assert.equal(
          (err as ApiError).code,
          'PAYMENT_NOT_REFUNDABLE',
          `expected PAYMENT_NOT_REFUNDABLE for status='${status}'`
        )
        assert.equal((err as ApiError).status, 422, 'expected 422 status')
        return true
      }
    )
  }
})

test('triggerRefund throws PAYMENT_MISSING_INTENT when stripe_payment_intent_id is null', async () => {
  const client = makeMockClient({
    data: {
      id: '33333333-3333-3333-3333-333333333333',
      status: 'succeeded',
      stripe_payment_intent_id: null,
      amount: 100,
    },
    error: null,
  })

  await assert.rejects(
    triggerRefund(client as never, {
      paymentId: '33333333-3333-3333-3333-333333333333',
      actorProfileId: '00000000-0000-0000-0000-00000000aaaa',
    }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError, 'expected ApiError')
      assert.equal(
        (err as ApiError).code,
        'PAYMENT_MISSING_INTENT',
        'expected PAYMENT_MISSING_INTENT code'
      )
      assert.equal((err as ApiError).status, 422, 'expected 422 status')
      return true
    }
  )
})

test('triggerRefund surfaces supabase load errors as Error (not ApiError)', async () => {
  const client = makeMockClient({
    data: null,
    error: { message: 'connection refused' },
  })

  await assert.rejects(
    triggerRefund(client as never, {
      paymentId: '44444444-4444-4444-4444-444444444444',
      actorProfileId: '00000000-0000-0000-0000-00000000aaaa',
    }),
    (err: unknown) => {
      assert.ok(err instanceof Error, 'expected generic Error')
      assert.ok(
        (err as Error).message.includes('Failed to load payment'),
        'expected error message to mention load failure'
      )
      // NOT an ApiError — the caller will surface this as 500 in toErrorResponse.
      assert.ok(!(err instanceof ApiError), 'should not be ApiError')
      return true
    }
  )
})
