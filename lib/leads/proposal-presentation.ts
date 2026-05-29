import type { LeadOrigin, LeadProposal } from '@/lib/types'

// Presentation layer for proposal state. A proposal carries THREE independent
// status axes (`status`, `reviewStatus`, `paymentStatus`) plus the linked
// project and an active checkout link. Rendering all of them as separate badges
// duplicates information and reads as ambiguous (two distinct "accept"-like
// concepts: PM `reviewStatus=approved` vs lifecycle `status=accepted`).
//
// This module collapses those axes into a single "effective state" chip — the
// most advanced fact about the proposal — plus an optional secondary chip for
// payment anomalies the primary chip does not already imply. It is a pure,
// origin-aware function so it can be unit-tested exhaustively and guarantees no
// change to the underlying state machine (data model, RPC, payment gate, and
// cross-repo contract are untouched).
//
// Origin matters because the lifecycle is driven by different actors:
//   - inbound  (web/Maxwell): the client accepts and pays on NoonWeb; the App's
//     `status` stays `draft` until the payment-activation RPC jumps it straight
//     to `handoff_ready`. The manual `status` select is meaningless here.
//   - outbound (seller-created in App): the seller drives `draft → sent` to
//     unlock the checkout link; `accepted`/`handoff_ready` still arrive only via
//     the payment RPC, never by hand.

const COLORS = {
  emerald: 'bg-emerald-500/10 text-emerald-700',
  primary: 'bg-primary/10 text-primary',
  blue: 'bg-blue-500/10 text-blue-700',
  yellow: 'bg-yellow-500/10 text-yellow-700',
  amber: 'bg-amber-500/10 text-amber-700',
  red: 'bg-red-500/10 text-red-700',
  slate: 'bg-slate-500/10 text-slate-700',
  slateMuted: 'bg-slate-500/10 text-slate-500',
} as const

export interface ProposalStateChip {
  /** Stable, locale-independent identifier — the unit-test anchor. */
  key: string
  label: string
  color: string
}

export interface EffectiveProposalState {
  primary: ProposalStateChip
  /** Payment anomaly the primary chip does not already convey (e.g. failed). */
  secondary: ProposalStateChip | null
  /** Optional one-line clarification shown under the chip. */
  hint?: string
}

/** Minimal slice of a proposal the derivation needs. */
export type ProposalStateInput = Pick<
  LeadProposal,
  'status' | 'reviewStatus' | 'paymentStatus' | 'linkedProject' | 'activeCheckoutLink'
>

/**
 * Collapse a proposal's three status axes into one effective-state chip.
 *
 * Priority is "most advanced fact wins": a converted proposal reads as
 * converted regardless of the other axes, a paid one as paid, and so on down
 * to the draft fallback. The order below is the single source of truth for that
 * precedence; the unit tests pin every branch.
 */
export function deriveEffectiveProposalState(
  proposal: ProposalStateInput,
  leadOrigin: LeadOrigin | undefined,
): EffectiveProposalState {
  const { status, reviewStatus, paymentStatus, linkedProject, activeCheckoutLink } = proposal
  const isInbound = leadOrigin === 'inbound'

  // A failed payment is surfaced alongside (not instead of) the lifecycle state
  // so the operator still sees where the proposal is while knowing a charge
  // failed. Succeeded/refunded are terminal enough to be the primary chip.
  const secondary: ProposalStateChip | null =
    paymentStatus === 'failed'
      ? { key: 'payment_failed', label: 'Pago fallido', color: COLORS.red }
      : null

  // 1. Converted: a project exists — the terminal happy path.
  if (linkedProject) {
    return { primary: { key: 'converted', label: 'Convertida', color: COLORS.emerald }, secondary }
  }

  // 2. Paid: payment confirmed (the RPC also set status=handoff_ready).
  if (paymentStatus === 'succeeded') {
    return {
      primary: { key: 'paid', label: 'Pagada', color: COLORS.emerald },
      secondary: null,
      hint: status === 'handoff_ready' ? 'Lista para crear el proyecto.' : undefined,
    }
  }

  // 3. Refunded.
  if (paymentStatus === 'refunded') {
    return { primary: { key: 'refunded', label: 'Reembolsada', color: COLORS.slateMuted }, secondary: null }
  }

  // 4. PM review terminals / gate. The review axis governs everything before
  //    payment: nothing can advance until the PM approves.
  if (reviewStatus === 'rejected') {
    return { primary: { key: 'review_rejected', label: 'Rechazada por PM', color: COLORS.red }, secondary }
  }
  if (reviewStatus === 'cancelled') {
    return { primary: { key: 'cancelled', label: 'Cancelada', color: COLORS.slateMuted }, secondary }
  }
  if (reviewStatus === 'expired') {
    return { primary: { key: 'expired', label: 'Expirada', color: COLORS.slateMuted }, secondary }
  }
  if (reviewStatus === 'changes_requested') {
    return { primary: { key: 'changes_requested', label: 'Ajustes solicitados', color: COLORS.amber }, secondary }
  }
  if (reviewStatus === 'pending_review') {
    return { primary: { key: 'in_review', label: 'En revisión PM', color: COLORS.yellow }, secondary }
  }

  // 5. Approved by PM, not yet paid. With a checkout link the proposal is out
  //    to the client awaiting payment; without one it is approved and ready to
  //    send. Origin only refines the wording.
  if (reviewStatus === 'approved') {
    if (activeCheckoutLink) {
      return {
        primary: { key: 'awaiting_payment', label: 'Esperando pago', color: COLORS.blue },
        secondary,
        hint: isInbound ? 'El cliente paga desde la web.' : undefined,
      }
    }
    return { primary: { key: 'approved', label: 'Aprobada', color: COLORS.primary }, secondary }
  }

  // 6. Proposal-level rejection (outbound seller marked it dead).
  if (status === 'rejected') {
    return { primary: { key: 'rejected', label: 'Rechazada', color: COLORS.red }, secondary }
  }

  // 7. Fallback: draft / not yet submitted.
  return { primary: { key: 'draft', label: 'Borrador', color: COLORS.slate }, secondary }
}

/**
 * Manual `status` transitions the operator may legitimately drive by hand.
 *
 * - inbound: none — the lifecycle is owned by NoonWeb (client accept) and the
 *   payment RPC. The select is hidden entirely.
 * - outbound: `draft → sent` (unlocks the checkout link) and `rejected` (mark
 *   the proposal dead). `accepted`/`handoff_ready` are payment-driven and are
 *   intentionally NOT manual options.
 *
 * `undefined` origin is treated as outbound (conservative: keeps the control).
 */
export function manualProposalStatusOptions(
  leadOrigin: LeadOrigin | undefined,
): Array<LeadProposal['status']> {
  if (leadOrigin === 'inbound') {
    return []
  }
  return ['draft', 'sent', 'rejected']
}
