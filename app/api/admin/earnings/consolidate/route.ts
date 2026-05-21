import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import { consolidateEarningsForPayment } from '@/lib/server/earnings/consolidation-service'

// Operator-side manual trigger for the same atomic consolidation primitive
// the daily Vercel cron uses (`/api/cron/consolidate-earnings`). Delegates
// to `consolidate_payment_earnings` RPC per ADR-015: row-locks
// `seller_fees`, transitions state `confirmed → pending_payout`, moves
// every actor wallet from `pending` to `available_to_withdraw`, and writes
// audit ledger pairs — all inside one Postgres transaction. Idempotent
// re-invocation per migration 0049 idempotency guards.
//
// Use case: edge ops scenarios where an admin needs to consolidate a
// specific payment before the next cron window (e.g., a payment that
// crossed the cooling threshold mid-day, or a manual investigation).
// Routine consolidation is handled by the daily cron — operators do not
// need this endpoint in normal flow.

const consolidateSchema = z.object({
  paymentId: z.string().uuid(),
})

export async function POST(request: Request) {
  try {
    const principal = await requireRole(['admin'])
    const body = consolidateSchema.parse(await request.json())

    const adminClient = createSupabaseAdminClient()

    const result = await consolidateEarningsForPayment(adminClient, {
      paymentId: body.paymentId,
      actorProfileId: principal.userId,
    })

    return NextResponse.json({ data: result })
  } catch (err) {
    return toErrorResponse(err)
  }
}
