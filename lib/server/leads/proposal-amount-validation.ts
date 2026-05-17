import { ApiError } from '@/lib/server/api/errors'
import {
  computePricing,
  type Complexity,
  type ProjectType,
  type SellerFeeAmount,
} from '@/lib/maxwell/pricing'
import type { CreateLeadProposalInput } from './proposal-schema'

// Default seller fee for outbound proposals when the caller does not
// supply one. Mirrors the default applied in the proposal route when
// persisting the seller_fees row.
export const DEFAULT_OUTBOUND_SELLER_FEE_AMOUNT = 100

export class ProposalAmountPricingMismatchError extends ApiError {
  constructor(
    readonly receivedAmount: number,
    readonly expectedAmount: number,
    readonly projectType: ProjectType,
    readonly complexity: Complexity,
    readonly sellerFeeAmount: SellerFeeAmount,
  ) {
    super(
      'PROPOSAL_AMOUNT_PRICING_MISMATCH',
      `Outbound proposal amount ($${receivedAmount}) does not match the canonical activation total ($${expectedAmount}) for ` +
        `projectType=${projectType}, complexity=${complexity}, sellerFee=${sellerFeeAmount}. ` +
        'The activation amount must come from the pricing matrix (lib/maxwell/pricing.ts).',
      422,
    )
    this.name = 'ProposalAmountPricingMismatchError'
  }
}

export class ProposalMissingPricingContextError extends ApiError {
  constructor(missing: 'projectType' | 'complexity' | 'both') {
    super(
      'PROPOSAL_MISSING_PRICING_CONTEXT',
      missing === 'both'
        ? 'Outbound proposals require both projectType and complexity to compute the activation amount.'
        : `Outbound proposals require ${missing} to compute the activation amount.`,
      422,
    )
    this.name = 'ProposalMissingPricingContextError'
  }
}

// Revalidate that `proposal.amount` matches the canonical activation
// total computed by `computePricing()` for outbound proposals. Per
// ADR-013, this is the load-bearing defense that closes the bypass
// vector surfaced by B1.3a observation §2 (2026-05-17): without this
// check, the seller could submit any value from a hand-edited input
// and Stripe would charge that arbitrary value, divorcing the
// activation from the pricing matrix.
//
// Inbound proposals skip the check entirely — they do not carry a
// seller fee and their pricing is owned by NoonWeb per ADR-010.
//
// Legacy outbound proposals pre-ADR-013 will not carry projectType
// / complexity. They are rejected at proposal-creation time (this is
// new code, no in-flight legacy creation path exists). Existing
// legacy rows in lead_proposals are not touched; they continue to
// process through the webhook unchanged when their already-open
// Checkout sessions complete.
export function assertOutboundProposalAmountMatchesPricing(
  leadOrigin: string | null | undefined,
  payload: Pick<CreateLeadProposalInput, 'amount' | 'sellerFeeAmount' | 'projectType' | 'complexity'>,
): void {
  if (leadOrigin !== 'outbound') return

  const missingProjectType = !payload.projectType
  const missingComplexity = !payload.complexity

  if (missingProjectType && missingComplexity) {
    throw new ProposalMissingPricingContextError('both')
  }
  if (missingProjectType) {
    throw new ProposalMissingPricingContextError('projectType')
  }
  if (missingComplexity) {
    throw new ProposalMissingPricingContextError('complexity')
  }

  // sellerFeeAmount default mirrors the proposal route's default for
  // backwards compatibility with callers that pre-date the UI selector.
  // SellerFeeAmount = 0 | 100 | 300 | 500 in pricing.ts; outbound
  // proposals always use a non-zero fee, so coerce 100 as the floor.
  const sellerFeeAmount = (payload.sellerFeeAmount ?? DEFAULT_OUTBOUND_SELLER_FEE_AMOUNT) as SellerFeeAmount

  const pricing = computePricing(
    payload.projectType as ProjectType,
    payload.complexity as Complexity,
    'outbound',
    sellerFeeAmount,
  )

  if (payload.amount !== pricing.activationFinal) {
    throw new ProposalAmountPricingMismatchError(
      payload.amount,
      pricing.activationFinal,
      payload.projectType as ProjectType,
      payload.complexity as Complexity,
      sellerFeeAmount,
    )
  }
}
