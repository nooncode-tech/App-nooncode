import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '@/lib/server/api/errors'
import type { Database } from '@/lib/server/supabase/database.types'

// Wrapper for the `debit_wallet_for_refund` RPC defined in migration
// 0050_phase_19d_debit_wallet_for_refund_rpc.sql (Path G). The RPC is
// the atomic primitive that reverses wallet credits when a Stripe
// refund fires. Behavior:
//   - Detects whether the payment was consolidated (post-cron path)
//     vs still in `pending` (pre-cron) and debits the correct bucket.
//   - Idempotent on retries (Stripe webhook retries are common):
//     prior refund debit on the same payment is a no-op.
//   - Defensive bucket-balance check: skips actors whose funds were
//     already moved out (likely to `locked` via payout initiation).
//     `actorsSkippedAlreadyPaidOut` surfaces the count for downstream
//     alerting / manual reconciliation.
//   - Caller (handleChargeRefunded) handles the seller_fees state
//     transition to `cancelled` separately via cancelSellerFee service.
//   - Caller should catch errors and log without failing the webhook —
//     the payment + project + state-machine reversal already
//     committed; the wallet debit failure surfaces for manual handling.

type DatabaseClient = SupabaseClient<Database>

export interface DebitWalletForRefundResult {
  paymentId: string
  actorsDebited: number
  actorsSkippedAlreadyPaidOut: number
  amountDebited: number
  bucketUsed: 'pending' | 'available_to_withdraw' | 'noop_already_refunded'
}

function mapRpcError(error: { message?: string } | null): Error {
  const message = error?.message ?? 'Wallet refund debit failed.'
  if (message.includes('PAYMENT_ID_REQUIRED')) {
    return new ApiError('PAYMENT_ID_REQUIRED', 'Payment ID is required to debit refund.', 422)
  }
  return new Error(message)
}

export async function debitWalletForRefund(
  adminClient: DatabaseClient,
  input: { paymentId: string; actorProfileId?: string | null },
): Promise<DebitWalletForRefundResult> {
  const { data, error } = await adminClient.rpc('debit_wallet_for_refund', {
    p_payment_id: input.paymentId,
    p_actor_profile_id: input.actorProfileId ?? undefined,
  })

  if (error) {
    throw mapRpcError(error)
  }

  const row = Array.isArray(data) ? data[0] : data

  if (!row) {
    throw new Error('DEBIT_WALLET_FOR_REFUND_RETURNED_NO_DATA')
  }

  return {
    paymentId: row.payment_id,
    actorsDebited: row.actors_debited,
    actorsSkippedAlreadyPaidOut: row.actors_skipped_already_paid_out,
    amountDebited: Number(row.amount_debited),
    bucketUsed: row.bucket_used as DebitWalletForRefundResult['bucketUsed'],
  }
}
