import { ApiError } from '@/lib/server/api/errors'
import type { CreateLeadProposalInput } from './proposal-schema'

// Default seller fee for outbound proposals when the caller does not supply
// one (legacy clients pre-Chunk-4 selector). Mirrors the same default used
// in app/api/leads/[leadId]/proposals/route.ts when persisting the
// seller_fees row.
export const DEFAULT_OUTBOUND_SELLER_FEE_AMOUNT = 100

export class ProposalAmountBelowSellerFeeError extends ApiError {
  constructor(
    readonly amount: number,
    readonly sellerFeeAmount: number,
  ) {
    super(
      'PROPOSAL_AMOUNT_BELOW_SELLER_FEE',
      `Outbound proposal amount ($${amount}) must be at least the seller fee ($${sellerFeeAmount}). ` +
        'Lower the seller fee or raise the proposal amount before saving.',
      422,
    )
    this.name = 'ProposalAmountBelowSellerFeeError'
  }
}

// Reject outbound proposals where the proposal amount cannot cover the
// seller fee. Without this guard, a $1 outbound proposal with a $100 seller
// fee would create an inconsistent state machine: the seller fee row gets
// persisted at $100 but the webhook activation amount is only $1, leaving
// nothing for the developer/noon split and overcrediting the seller. The
// webhook handler also caps `sellerFeeAmount` at `activationAmount` as a
// defense-in-depth measure for legacy rows; this guard prevents the
// configuration from being saved in the first place. Inbound proposals are
// not affected (they do not carry a seller fee).
export function assertProposalAmountCoversSellerFee(
  leadOrigin: string | null | undefined,
  payload: Pick<CreateLeadProposalInput, 'amount' | 'sellerFeeAmount'>,
): void {
  if (leadOrigin !== 'outbound') return

  const effectiveSellerFee = payload.sellerFeeAmount ?? DEFAULT_OUTBOUND_SELLER_FEE_AMOUNT
  if (payload.amount < effectiveSellerFee) {
    throw new ProposalAmountBelowSellerFeeError(payload.amount, effectiveSellerFee)
  }
}
