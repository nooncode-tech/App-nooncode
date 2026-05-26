import { z } from 'zod'

import { ApiError, ConflictApiError, NotFoundApiError } from '@/lib/server/api/errors'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import {
  getProposalReviewDecisionWebhookUrl,
  signWebsitePayload,
} from '@/lib/server/website-webhook-auth'
import { activatePaidProposal } from '@/lib/server/payments/activation'
import { creditActivationEarnings } from '@/lib/server/earnings/activation-credit'
import {
  countPrototypeWorkspaceVersionForLead,
  getPrototypeWorkspaceByLeadId,
  getPrototypeWorkspaceByShareToken,
  type PrototypeSignedReadRow,
} from '@/lib/server/prototypes/repository'
import { ensureWebsiteInboundPrototypeWorkspace } from '@/lib/server/prototypes/website-inbound'
import { errorToLogContext, logger } from '@/lib/server/api/logger'
import { createPrototypeDecisionDraft } from '@/lib/server/maxwell/prototype-decision-draft'

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>

// The integration table is created by a local migration and may be ahead of the
// generated Supabase types in this repo. Keep the untyped boundary isolated here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function table(client: SupabaseAdminClient, name: string): any {
  return client.from(name as never)
}

const looseRecordSchema = z.record(z.string(), z.unknown()).default({})
const optionalTextSchema = z.string().trim().min(1).optional().nullable()

const customerSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  phone: optionalTextSchema,
  whatsapp: optionalTextSchema,
  company: optionalTextSchema,
})

const proposalSnapshotSchema = z.object({
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
  amount: z.coerce.number().nonnegative(),
  currency: z.string().trim().min(3).max(8).default('USD'),
})

const maxwellSnapshotSchema = z
  .object({
    summary: optionalTextSchema,
    session_url: optionalTextSchema,
    prototype_url: optionalTextSchema,
    prototype_versions: z
      .array(
        z.object({
          label: optionalTextSchema,
          url: optionalTextSchema,
          version_number: z.coerce.number().int().positive().optional().nullable(),
          v0_chat_id: optionalTextSchema,
        })
      )
      .default([]),
  })
  .default({})

export const websiteInboundProposalPayloadSchema = z.object({
  external_source: z.string().trim().min(1).default('noon_website'),
  external_session_id: z.string().trim().min(1),
  external_proposal_id: z.string().trim().min(1),
  customer: customerSchema,
  proposal: proposalSnapshotSchema,
  maxwell: maxwellSnapshotSchema,
  metadata: looseRecordSchema,
})

export const websitePaymentConfirmedPayloadSchema = z.object({
  external_source: z.string().trim().min(1).default('noon_website'),
  external_session_id: z.string().trim().min(1),
  external_proposal_id: z.string().trim().min(1),
  external_payment_id: z.string().trim().min(1),
  customer: customerSchema.optional(),
  proposal: proposalSnapshotSchema.optional(),
  maxwell: maxwellSnapshotSchema,
  handoff: looseRecordSchema,
  payment: z
    .object({
      amount: z.coerce.number().nonnegative(),
      currency: z.string().trim().min(3).max(8).default('USD'),
      provider: optionalTextSchema,
      paid_at: optionalTextSchema,
    })
    .optional(),
  metadata: looseRecordSchema,
})

type WebsiteInboundProposalPayload = z.infer<typeof websiteInboundProposalPayloadSchema>
type WebsitePaymentConfirmedPayload = z.infer<typeof websitePaymentConfirmedPayloadSchema>

interface WebsiteInboundLinkRow {
  id: string
  external_source: string
  external_session_id: string
  external_proposal_id: string
  external_payment_id: string | null
  lead_id: string
  proposal_id: string
  project_id: string | null
  current_status: string
  review_webhook_status: string | null
  review_webhook_error: string | null
  inbound_payload: unknown
  payment_payload: unknown
}

type WebsiteReviewAction = 'approve' | 'reject' | 'request_changes' | 'cancel'

const reviewDecisionByAction: Record<WebsiteReviewAction, 'approved' | 'rejected' | 'changes_requested' | 'cancelled'> = {
  approve: 'approved',
  reject: 'rejected',
  request_changes: 'changes_requested',
  cancel: 'cancelled',
}

function normalizeCurrency(value?: string | null) {
  return (value ?? 'USD').trim().toUpperCase()
}

function readInboundScore(metadata: Record<string, unknown>) {
  const rawScore = Number(metadata.score ?? 80)
  return Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 80
}

function isMissingInboundTable(error: { code?: string; message?: string } | null) {
  return error?.code === '42P01' || error?.message?.includes('website_inbound_links') === true
}

function buildInboundLeadNotes(payload: WebsiteInboundProposalPayload) {
  const notes = [
    'Inbound website via Maxwell.',
    `External session: ${payload.external_session_id}`,
    `External proposal: ${payload.external_proposal_id}`,
  ]

  if (payload.maxwell.summary) {
    notes.push(`Maxwell summary: ${payload.maxwell.summary}`)
  }

  if (payload.maxwell.prototype_url) {
    notes.push(`Prototype: ${payload.maxwell.prototype_url}`)
  }

  return notes.join('\n')
}

async function linkInboundPrototypeWorkspaceToProject(
  client: SupabaseAdminClient,
  leadId: string,
  projectId: string
) {
  const workspace = await getPrototypeWorkspaceByLeadId(client, leadId)

  if (!workspace || workspace.project_id) {
    return
  }

  const { error } = await client
    .from('prototype_workspaces')
    .update({
      project_id: projectId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', workspace.id)

  if (error) {
    throw new ApiError('INBOUND_PROTOTYPE_LINK_FAILED', error.message, 500)
  }
}

function buildProjectDescription(payload: WebsitePaymentConfirmedPayload, proposal: { body?: string | null }) {
  const handoffSummary =
    typeof payload.handoff.summary === 'string' ? payload.handoff.summary.trim() : ''
  const maxwellSummary = payload.maxwell.summary?.trim() ?? ''

  return [handoffSummary, maxwellSummary, proposal.body ?? '']
    .filter(Boolean)
    .join('\n\n')
}

async function resolveIntegrationActorId(client: SupabaseAdminClient) {
  const { data, error } = await table(client, 'user_profiles')
    .select('id, role')
    .in('role', ['admin', 'pm'])
    .eq('is_active', true)
    .order('role', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new ApiError('INTEGRATION_ACTOR_LOOKUP_FAILED', error.message, 500)
  }

  if (!data?.id) {
    throw new ApiError(
      'INTEGRATION_ACTOR_NOT_FOUND',
      'An active admin or PM profile is required to receive website inbound handoffs.',
      503
    )
  }

  return data.id as string
}

async function findLinkByExternalRef(
  client: SupabaseAdminClient,
  input: {
    external_source: string
    external_session_id?: string
    external_proposal_id?: string
    external_payment_id?: string
  }
): Promise<WebsiteInboundLinkRow | null> {
  if (input.external_payment_id) {
    const { data, error } = await table(client, 'website_inbound_links')
      .select('*')
      .eq('external_source', input.external_source)
      .eq('external_payment_id', input.external_payment_id)
      .maybeSingle()

    if (error) throw new ApiError('INBOUND_LINK_LOOKUP_FAILED', error.message, 500)
    if (data) return data as WebsiteInboundLinkRow
  }

  if (input.external_proposal_id) {
    const { data, error } = await table(client, 'website_inbound_links')
      .select('*')
      .eq('external_source', input.external_source)
      .eq('external_proposal_id', input.external_proposal_id)
      .maybeSingle()

    if (error) throw new ApiError('INBOUND_LINK_LOOKUP_FAILED', error.message, 500)
    if (data) return data as WebsiteInboundLinkRow
  }

  if (input.external_session_id) {
    const { data, error } = await table(client, 'website_inbound_links')
      .select('*')
      .eq('external_source', input.external_source)
      .eq('external_session_id', input.external_session_id)
      .maybeSingle()

    if (error) throw new ApiError('INBOUND_LINK_LOOKUP_FAILED', error.message, 500)
    return (data as WebsiteInboundLinkRow | null) ?? null
  }

  return null
}

async function getLinkByProposalId(client: SupabaseAdminClient, proposalId: string) {
  const { data, error } = await table(client, 'website_inbound_links')
    .select('*')
    .eq('proposal_id', proposalId)
    .maybeSingle()

  if (isMissingInboundTable(error)) return null
  if (error) throw new ApiError('INBOUND_LINK_LOOKUP_FAILED', error.message, 500)
  return (data as WebsiteInboundLinkRow | null) ?? null
}

async function updateInboundProposalSnapshot(
  client: SupabaseAdminClient,
  link: WebsiteInboundLinkRow,
  payload: WebsiteInboundProposalPayload
) {
  if (!['proposal_pending_review', 'proposal_changes_requested'].includes(link.current_status)) {
    await table(client, 'website_inbound_links')
      .update({ inbound_payload: payload })
      .eq('id', link.id)
    return
  }

  const actorId = await resolveIntegrationActorId(client)

  const [{ error: leadError }, { error: proposalError }, { error: linkError }] = await Promise.all([
    table(client, 'leads')
      .update({
        name: payload.customer.name,
        email: payload.customer.email.toLowerCase(),
        company: payload.customer.company ?? null,
        phone: payload.customer.phone ?? payload.customer.whatsapp ?? null,
        source: 'website',
        status: 'proposal',
        score: readInboundScore(payload.metadata),
        value: payload.proposal.amount,
        notes: buildInboundLeadNotes(payload),
        updated_at: new Date().toISOString(),
      })
      .eq('id', link.lead_id),
    table(client, 'lead_proposals')
      .update({
        title: payload.proposal.title,
        body: payload.proposal.body,
        amount: payload.proposal.amount,
        currency: normalizeCurrency(payload.proposal.currency),
        review_status: 'pending_review',
        status: 'draft',
        created_by: actorId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', link.proposal_id),
    table(client, 'website_inbound_links')
      .update({
        external_session_id: payload.external_session_id,
        external_proposal_id: payload.external_proposal_id,
        current_status: 'proposal_pending_review',
        review_webhook_status: 'pending',
        review_webhook_error: null,
        inbound_payload: payload,
      })
      .eq('id', link.id),
  ])

  if (leadError) throw new ApiError('INBOUND_LEAD_UPDATE_FAILED', leadError.message, 500)
  if (proposalError) throw new ApiError('INBOUND_PROPOSAL_UPDATE_FAILED', proposalError.message, 500)
  if (linkError) throw new ApiError('INBOUND_LINK_UPDATE_FAILED', linkError.message, 500)
}

export async function receiveWebsiteInboundProposal(payload: WebsiteInboundProposalPayload) {
  const client = createSupabaseAdminClient()
  const existingLink = await findLinkByExternalRef(client, payload)

  if (existingLink) {
    await updateInboundProposalSnapshot(client, existingLink, payload)
    await ensureWebsiteInboundPrototypeWorkspace(client, {
      leadId: existingLink.lead_id,
      requestedByProfileId: await resolveIntegrationActorId(client),
      maxwell: payload.maxwell,
    })
    return {
      idempotent: true,
      linkId: existingLink.id,
      leadId: existingLink.lead_id,
      proposalId: existingLink.proposal_id,
      status: existingLink.current_status,
    }
  }

  const actorId = await resolveIntegrationActorId(client)
  const now = new Date().toISOString()

  const { data: lead, error: leadError } = await table(client, 'leads')
    .insert({
      name: payload.customer.name,
      email: payload.customer.email.toLowerCase(),
      phone: payload.customer.phone ?? payload.customer.whatsapp ?? null,
      company: payload.customer.company ?? null,
      source: 'website',
      status: 'proposal',
      score: readInboundScore(payload.metadata),
      value: payload.proposal.amount,
      created_by: actorId,
      assigned_to: null,
      tags: ['inbound', 'website', 'maxwell'],
      notes: buildInboundLeadNotes(payload),
      lead_origin: 'inbound',
    })
    .select('id')
    .single()

  if (leadError || !lead?.id) {
    throw new ApiError('INBOUND_LEAD_CREATE_FAILED', leadError?.message ?? 'Lead was not created.', 500)
  }

  const { data: proposal, error: proposalError } = await table(client, 'lead_proposals')
    .insert({
      lead_id: lead.id,
      created_by: actorId,
      title: payload.proposal.title,
      body: payload.proposal.body,
      amount: payload.proposal.amount,
      currency: normalizeCurrency(payload.proposal.currency),
      status: 'draft',
      review_status: 'pending_review',
      payment_status: null,
      is_special_case: false,
    })
    .select('id')
    .single()

  if (proposalError || !proposal?.id) {
    throw new ApiError(
      'INBOUND_PROPOSAL_CREATE_FAILED',
      proposalError?.message ?? 'Proposal was not created.',
      500
    )
  }

  const { data: link, error: linkError } = await table(client, 'website_inbound_links')
    .insert({
      external_source: payload.external_source,
      external_session_id: payload.external_session_id,
      external_proposal_id: payload.external_proposal_id,
      lead_id: lead.id,
      proposal_id: proposal.id,
      current_status: 'proposal_pending_review',
      review_webhook_status: 'pending',
      inbound_payload: payload,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single()

  if (linkError || !link?.id) {
    throw new ApiError(
      'INBOUND_LINK_CREATE_FAILED',
      linkError?.message ?? 'Inbound integration link was not created.',
      500
    )
  }

  await ensureWebsiteInboundPrototypeWorkspace(client, {
    leadId: lead.id as string,
    requestedByProfileId: actorId,
    maxwell: payload.maxwell,
  })

  return {
    idempotent: false,
    linkId: link.id as string,
    leadId: lead.id as string,
    proposalId: proposal.id as string,
    status: 'proposal_pending_review',
  }
}

async function createPaymentRecordIfMissing(
  client: SupabaseAdminClient,
  input: {
    proposalId: string
    projectId?: string | null
    amount: number
    currency: string
    paidAt: string
    externalPaymentId: string
    payload: WebsitePaymentConfirmedPayload
  }
) {
  const { data: existingPayment, error: lookupError } = await table(client, 'payments')
    .select('id')
    .eq('proposal_id', input.proposalId)
    .eq('status', 'succeeded')
    .maybeSingle()

  if (lookupError) {
    throw new ApiError('INBOUND_PAYMENT_LOOKUP_FAILED', lookupError.message, 500)
  }

  if (existingPayment?.id) {
    return existingPayment.id as string
  }

  const { data: payment, error } = await table(client, 'payments')
    .insert({
      proposal_id: input.proposalId,
      project_id: input.projectId ?? null,
      payment_type: 'full_project',
      amount: input.amount,
      currency: normalizeCurrency(input.currency),
      status: 'succeeded',
      paid_at: input.paidAt,
      metadata: {
        source: 'noon_website',
        external_payment_id: input.externalPaymentId,
        external_session_id: input.payload.external_session_id,
        external_proposal_id: input.payload.external_proposal_id,
        website_metadata: input.payload.metadata,
      },
    })
    .select('id')
    .single()

  if (error || !payment?.id) {
    throw new ApiError('INBOUND_PAYMENT_CREATE_FAILED', error?.message ?? 'Payment was not recorded.', 500)
  }

  return payment.id as string
}

async function getApprovedInboundProposalForPayment(
  client: SupabaseAdminClient,
  proposalId: string
) {
  const { data: proposal, error } = await table(client, 'lead_proposals')
    .select('id, title, body, amount, currency, lead_id, review_status')
    .eq('id', proposalId)
    .single()

  if (error || !proposal) {
    throw new NotFoundApiError('Inbound proposal was not found.', 'INBOUND_PROPOSAL_NOT_FOUND')
  }

  if (proposal.review_status !== 'approved') {
    throw new ConflictApiError(
      'Inbound payment cannot activate a project before PM approval.',
      'INBOUND_PAYMENT_REQUIRES_PM_APPROVAL'
    )
  }

  return proposal as {
    id: string
    title: string
    body: string | null
    amount: number
    currency: string
    lead_id: string
    review_status: string
  }
}

export async function receiveWebsitePaymentConfirmed(
  payload: WebsitePaymentConfirmedPayload,
  /**
   * Optional Supabase admin client override. Defaults to a freshly created
   * admin client in production. Tests inject a mock to assert the chain of
   * writes (link lookup, payment record, activation RPC, project lookup,
   * earnings_ledger upsert, credit_wallet_bucket RPC, link update).
   */
  clientOverride?: SupabaseAdminClient,
) {
  const client = clientOverride ?? createSupabaseAdminClient()
  let link = await findLinkByExternalRef(client, {
    external_source: payload.external_source,
    external_session_id: payload.external_session_id,
    external_proposal_id: payload.external_proposal_id,
    external_payment_id: payload.external_payment_id,
  })

  if (!link) {
    if (!payload.customer || !payload.proposal) {
      throw new ConflictApiError(
        'First-time payment handoff requires customer and proposal snapshots.',
        'INBOUND_PAYMENT_MISSING_SNAPSHOT'
      )
    }

    const created = await receiveWebsiteInboundProposal({
      external_source: payload.external_source,
      external_session_id: payload.external_session_id,
      external_proposal_id: payload.external_proposal_id,
      customer: payload.customer,
      proposal: payload.proposal,
      maxwell: payload.maxwell,
      metadata: payload.metadata,
    })

    link = await getLinkByProposalId(client, created.proposalId)
  }

  if (!link) {
    throw new ApiError('INBOUND_LINK_NOT_FOUND', 'Inbound link was not found after creation.', 500)
  }

  if (link.external_payment_id && link.external_payment_id !== payload.external_payment_id) {
    throw new ConflictApiError('Inbound proposal already has a different payment id.')
  }

  const proposalForPayment = await getApprovedInboundProposalForPayment(client, link.proposal_id)
  const paidAt = payload.payment?.paid_at ?? new Date().toISOString()

  const paymentId = await createPaymentRecordIfMissing(client, {
    proposalId: link.proposal_id,
    amount: payload.payment?.amount ?? payload.proposal?.amount ?? proposalForPayment.amount,
    currency: payload.payment?.currency ?? payload.proposal?.currency ?? proposalForPayment.currency,
    paidAt,
    externalPaymentId: payload.external_payment_id,
    payload,
  })

  const actorId = await resolveIntegrationActorId(client)
  const activation = await activatePaidProposal(client, {
    paymentId,
    paidAt,
    actorProfileId: actorId,
    metadata: {
      source: 'noon_website',
      external_payment_id: payload.external_payment_id,
      external_session_id: payload.external_session_id,
      external_proposal_id: payload.external_proposal_id,
    },
    projectDescription: buildProjectDescription(payload, proposalForPayment),
  })

  // Auto-credit developer + noon shares for this inbound activation.
  // Inbound has no seller (no seller_fees row by design — ADR-007 + ADR-010).
  // The service is the shared allocation policy holder (ADR-021); it
  // dedupes via the SQL-level idempotency keys, so replay-safe under any
  // retry path (transport ledger replay, webhook retry from NoonWeb,
  // or activatePaidProposal returning the same project_id on retry).
  const { data: project } = await table(client, 'projects')
    .select('developer_user_id')
    .eq('id', activation.project_id)
    .maybeSingle()
  const developerUserId: string | null = project?.developer_user_id ?? null

  const activationAmount = Number(
    payload.payment?.amount ?? payload.proposal?.amount ?? proposalForPayment.amount,
  )

  // Hard-pin USD (F-S-R4-1 mitigation, security review 2026-05-23): the
  // Stripe outbound handler hardcodes USD; the inbound credit call mirrors
  // that to prevent a NoonWeb-supplied currency from creating a mismatched
  // wallet_ledger_entries.currency vs wallet_accounts.currency (single-
  // currency-per-profile per migration 0036). Multi-currency support is a
  // v3 product decision with its own iteration scope.
  await creditActivationEarnings(client, {
    activationAmount,
    currency: 'USD',
    paymentId: activation.payment_id,
    proposalId: activation.proposal_id,
    leadId: link.lead_id,
    seller: null,
    developerUserId,
    channel: 'inbound',
    idempotencyKeyBase: `website:${payload.external_payment_id}`,
    actorProfileId: null,
  })

  const { error: linkError } = await table(client, 'website_inbound_links')
    .update({
      external_payment_id: payload.external_payment_id,
      project_id: activation.project_id,
      current_status: 'project_activated',
      payment_confirmed_at: paidAt,
      payment_payload: payload,
    })
    .eq('id', link.id)

  if (linkError) throw new ApiError('INBOUND_LINK_PAYMENT_UPDATE_FAILED', linkError.message, 500)

  await linkInboundPrototypeWorkspaceToProject(client, link.lead_id, activation.project_id)

  return {
    idempotent: Boolean(link.project_id || link.external_payment_id),
    linkId: link.id,
    leadId: link.lead_id,
    proposalId: link.proposal_id,
    projectId: activation.project_id,
    status: 'project_activated',
  }
}

export async function recordInboundReviewOutcome(
  proposalId: string,
  action: WebsiteReviewAction
) {
  const client = createSupabaseAdminClient()
  const link = await getLinkByProposalId(client, proposalId)

  if (!link) {
    return { applicable: false as const }
  }

  const statusByAction = {
    approve: 'proposal_approved',
    reject: 'proposal_rejected',
    request_changes: 'proposal_changes_requested',
    cancel: 'proposal_cancelled',
  } as const

  const { error } = await table(client, 'website_inbound_links')
    .update({
      current_status: statusByAction[action],
      review_webhook_status: 'pending',
      review_webhook_error: null,
    })
    .eq('id', link.id)

  if (error) throw new ApiError('INBOUND_REVIEW_STATUS_UPDATE_FAILED', error.message, 500)

  return { applicable: true as const, linkId: link.id, status: statusByAction[action] }
}

export async function sendProposalReviewDecisionToWebsite(
  proposalId: string,
  action: WebsiteReviewAction,
  actor?: { id?: string; email?: string; role?: string }
) {
  const client = createSupabaseAdminClient()
  const link = await getLinkByProposalId(client, proposalId)

  if (!link) {
    return { applicable: false as const, status: 'not_applicable' }
  }

  const { data: proposal, error: proposalError } = await table(client, 'lead_proposals')
    .select(
      'id, title, body, amount, currency, review_status, reviewed_at, lead:leads!lead_proposals_lead_id_fkey(id, name, email, company)'
    )
    .eq('id', proposalId)
    .single()

  if (proposalError || !proposal) {
    throw new NotFoundApiError('Inbound proposal was not found.', 'INBOUND_PROPOSAL_NOT_FOUND')
  }

  const expectedReviewStatusByAction = {
    approve: 'approved',
    reject: 'rejected',
    request_changes: 'changes_requested',
    cancel: 'cancelled',
  } as const

  if (proposal.review_status !== expectedReviewStatusByAction[action]) {
    return {
      applicable: true as const,
      status: 'not_ready',
      reason: 'Proposal review status does not match the requested website decision.',
    }
  }

  const url = getProposalReviewDecisionWebhookUrl()
  const now = new Date().toISOString()

  if (!url) {
    await table(client, 'website_inbound_links')
      .update({
        review_webhook_status: 'skipped',
        review_webhook_attempted_at: now,
        review_webhook_error: 'NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL is not configured.',
      })
      .eq('id', link.id)

    return {
      applicable: true as const,
      status: 'skipped',
      reason: 'NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL is not configured.',
    }
  }

  const bodyText = JSON.stringify({
    event: 'proposal_review_decision',
    decision: reviewDecisionByAction[action],
    external_source: link.external_source,
    external_session_id: link.external_session_id,
    external_proposal_id: link.external_proposal_id,
    noon_app: {
      lead_id: link.lead_id,
      proposal_id: link.proposal_id,
      reviewed_at: proposal.reviewed_at ?? now,
      reviewer: actor ?? null,
    },
    proposal: {
      title: proposal.title,
      body: proposal.body,
      amount: proposal.amount,
      currency: proposal.currency,
      review_status: proposal.review_status,
    },
    customer: proposal.lead ?? null,
  })

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: signWebsitePayload(bodyText),
      body: bodyText,
    })

    if (!response.ok) {
      const responseText = await response.text().catch(() => '')
      await table(client, 'website_inbound_links')
        .update({
          current_status: 'review_webhook_failed',
          review_webhook_status: 'failed',
          review_webhook_attempted_at: now,
          review_webhook_error: responseText || `Website returned HTTP ${response.status}.`,
        })
        .eq('id', link.id)

      return {
        applicable: true as const,
        status: 'failed',
        httpStatus: response.status,
        error: responseText || `Website returned HTTP ${response.status}.`,
      }
    }

    await table(client, 'website_inbound_links')
      .update({
        current_status: 'review_webhook_sent',
        review_webhook_status: 'sent',
        review_webhook_attempted_at: now,
        review_webhook_sent_at: now,
        review_webhook_error: null,
      })
      .eq('id', link.id)

    return { applicable: true as const, status: 'sent' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Website webhook failed.'

    await table(client, 'website_inbound_links')
      .update({
        current_status: 'review_webhook_failed',
        review_webhook_status: 'failed',
        review_webhook_attempted_at: now,
        review_webhook_error: message,
      })
      .eq('id', link.id)

    return { applicable: true as const, status: 'failed', error: message }
  }
}

// ---------------------------------------------------------------------------
// prototype-decision (inbound POST, ADR-023 + ADR-025, cross-repo §5)
// ---------------------------------------------------------------------------

const websitePrototypeDecisionNotesSchema = z
  .string()
  .trim()
  .max(2000, 'Prototype decision notes must be 2000 characters or fewer.')
  .optional()
  .nullable()

export const websitePrototypeDecisionPayloadSchema = z.object({
  external_source: z.string().trim().min(1).default('noon_website'),
  // Authoritative resolver per ADR-023 D2.
  token: z.string().trim().min(1),
  // Defensive cross-check per ADR-023 D2.
  prototype_workspace_id: z.string().uuid(),
  // Exact-set enum per ADR-023 D5 + cross-repo §5.2 / §5.5
  // (PROTOTYPE_DECISION_INVALID_DECISION).
  decision: z.enum(['accepted', 'rejected']),
  notes: websitePrototypeDecisionNotesSchema,
  client: z
    .object({
      user_agent: z.string().trim().max(500).optional().nullable(),
    })
    .optional(),
  metadata: looseRecordSchema,
})

export type WebsitePrototypeDecisionPayload = z.infer<
  typeof websitePrototypeDecisionPayloadSchema
>

export interface ReceiveWebsitePrototypeDecisionResult {
  idempotent: false
  decisionId: string
  prototypeWorkspaceId: string
  leadId: string
  decision: 'accepted' | 'rejected'
  decidedAt: string
  draftPropuestaQueued: boolean
  /** Convenience back-channel for the route handler structured log. */
  sellerProfileId: string
}

interface ResolvedPrototypeWorkspace {
  id: string
  lead_id: string
  status: string
  requested_by_profile_id: string
  share_token_superseded_at: string | null
}

async function resolvePrototypeWorkspaceByShareToken(
  client: SupabaseAdminClient,
  token: string,
): Promise<ResolvedPrototypeWorkspace | null> {
  const { data, error } = await table(client, 'prototype_workspaces')
    .select('id, lead_id, status, requested_by_profile_id, share_token_superseded_at')
    .eq('share_token', token)
    .maybeSingle()

  if (error) {
    throw new ApiError(
      'PROTOTYPE_DECISION_PERSIST_FAILED',
      `Prototype workspace lookup by share_token failed: ${error.message}`,
      500,
    )
  }

  return (data as ResolvedPrototypeWorkspace | null) ?? null
}

async function leadIsHardDeleted(
  client: SupabaseAdminClient,
  leadId: string,
): Promise<boolean> {
  const { data, error } = await table(client, 'leads')
    .select('id')
    .eq('id', leadId)
    .maybeSingle()

  if (error) {
    // Treat lookup failure as a server error rather than masking it as 410.
    throw new ApiError(
      'PROTOTYPE_DECISION_PERSIST_FAILED',
      `Lead presence check failed: ${error.message}`,
      500,
    )
  }

  return data === null
}

async function findExistingPrototypeDecision(
  client: SupabaseAdminClient,
  prototypeWorkspaceId: string,
): Promise<{ id: string; decision: string } | null> {
  const { data, error } = await table(client, 'prototype_decisions')
    .select('id, decision')
    .eq('prototype_workspace_id', prototypeWorkspaceId)
    .maybeSingle()

  if (error) {
    throw new ApiError(
      'PROTOTYPE_DECISION_PERSIST_FAILED',
      `Prototype decision uniqueness check failed: ${error.message}`,
      500,
    )
  }

  return (data as { id: string; decision: string } | null) ?? null
}

interface InsertedDecisionRow {
  id: string
  decided_at: string
}

async function insertPrototypeDecisionRow(
  client: SupabaseAdminClient,
  input: {
    prototypeWorkspaceId: string
    leadId: string
    decision: 'accepted' | 'rejected'
    notes: string | null
    clientUserAgent: string | null
    webhookEventId: string | null
  },
): Promise<InsertedDecisionRow> {
  const { data, error } = await table(client, 'prototype_decisions')
    .insert({
      prototype_workspace_id: input.prototypeWorkspaceId,
      lead_id: input.leadId,
      decision: input.decision,
      notes: input.notes,
      client_user_agent: input.clientUserAgent,
      webhook_event_id: input.webhookEventId,
    })
    .select('id, decided_at')
    .single()

  if (error || !data?.id) {
    throw new ApiError(
      'PROTOTYPE_DECISION_PERSIST_FAILED',
      `Prototype decision insert failed: ${error?.message ?? 'no row returned'}`,
      500,
    )
  }

  return data as InsertedDecisionRow
}

function buildSellerNotificationCopy(input: {
  decision: 'accepted' | 'rejected'
  draftStatus: 'queued' | 'failed' | 'not_applicable'
  truncatedNotes: string | null
}): { title: string; body: string } {
  if (input.decision === 'accepted') {
    if (input.draftStatus === 'failed') {
      return {
        title: 'Cliente aceptó el prototipo (acción manual requerida)',
        body:
          'El cliente aceptó tu prototipo. La generación automática del borrador de propuesta falló — ' +
          'creá la propuesta manualmente desde el detalle del lead.',
      }
    }
    return {
      title: 'Cliente aceptó el prototipo',
      body:
        'El cliente aceptó tu prototipo. Maxwell preparó un borrador de propuesta — ' +
        'revisalo y elegí tu seller fee antes de enviarlo a PM review.',
    }
  }

  const notesSegment = input.truncatedNotes ? ` Nota del cliente: "${input.truncatedNotes}".` : ''
  return {
    title: 'Cliente rechazó el prototipo',
    body:
      `El cliente rechazó tu prototipo.${notesSegment} ` +
      `Podés regenerar V2 si el lead lo amerita.`,
  }
}

function truncateNotesForNotification(notes: string | null): string | null {
  if (!notes) return null
  const trimmed = notes.trim()
  if (!trimmed) return null
  return trimmed.length > 240 ? `${trimmed.slice(0, 237)}...` : trimmed
}

async function insertSellerPrototypeDecisionNotification(
  client: SupabaseAdminClient,
  input: {
    sellerProfileId: string
    decisionId: string
    decision: 'accepted' | 'rejected'
    draftStatus: 'queued' | 'failed' | 'not_applicable'
    truncatedNotes: string | null
    leadId: string
  },
): Promise<void> {
  const copy = buildSellerNotificationCopy({
    decision: input.decision,
    draftStatus: input.draftStatus,
    truncatedNotes: input.truncatedNotes,
  })

  const { error } = await table(client, 'user_notifications').insert({
    profile_id: input.sellerProfileId,
    source_kind: 'prototype_decision_received',
    source_event_id: input.decisionId,
    domain: 'leads',
    title: copy.title,
    body: copy.body,
    href: `/dashboard/leads/${input.leadId}`,
  })

  if (error) {
    // Notification failure must NOT block the decision response. We log it
    // and continue; the decision row is already persisted and the wire-shape
    // response is correct. Operator visibility comes from the structured log.
    logger.warn('prototype.decision.notification_insert_failed', {
      sellerProfileId: input.sellerProfileId,
      decisionId: input.decisionId,
      leadId: input.leadId,
      decision: input.decision,
      errorMessage: error.message,
    })
  }
}

/**
 * Fire-and-forget Maxwell draft scheduler per ADR-023 D6 + OQ-2 resolution
 * (Backend 2026-05-25): detached promise with explicit `.catch()`. Safe
 * across Node 20 / 22 / Vercel serverless runtime; runs after the response
 * has been written to the wire (the awaited callsite returns BEFORE this
 * function awaits anything).
 */
export function scheduleAcceptedPrototypeDecisionSideEffects(input: {
  adminClient: SupabaseAdminClient
  decisionId: string
  prototypeWorkspaceId: string
  leadId: string
  sellerProfileId: string
}): void {
  void Promise.resolve().then(async () => {
    try {
      const draft = await createPrototypeDecisionDraft({
        client: input.adminClient,
        leadId: input.leadId,
        sellerProfileId: input.sellerProfileId,
        prototypeWorkspaceId: input.prototypeWorkspaceId,
        decisionId: input.decisionId,
      })

      logger.info('prototype.decision.accepted.draft_created', {
        decisionId: input.decisionId,
        prototypeWorkspaceId: input.prototypeWorkspaceId,
        leadId: input.leadId,
        sellerProfileId: input.sellerProfileId,
        proposalId: draft.proposalId,
        projectType: draft.projectType,
        complexity: draft.complexity,
        amount: draft.amount,
      })

      await insertSellerPrototypeDecisionNotification(input.adminClient, {
        sellerProfileId: input.sellerProfileId,
        decisionId: input.decisionId,
        decision: 'accepted',
        draftStatus: 'queued',
        truncatedNotes: null,
        leadId: input.leadId,
      })
    } catch (draftError) {
      logger.error('prototype.decision.accepted.draft_creation_failed', {
        decisionId: input.decisionId,
        prototypeWorkspaceId: input.prototypeWorkspaceId,
        leadId: input.leadId,
        sellerProfileId: input.sellerProfileId,
        ...errorToLogContext(draftError),
      })

      // Escalated notification: tell the seller to create the draft manually.
      await insertSellerPrototypeDecisionNotification(input.adminClient, {
        sellerProfileId: input.sellerProfileId,
        decisionId: input.decisionId,
        decision: 'accepted',
        draftStatus: 'failed',
        truncatedNotes: null,
        leadId: input.leadId,
      }).catch((notifError) => {
        logger.error('prototype.decision.accepted.escalation_notification_failed', {
          decisionId: input.decisionId,
          ...errorToLogContext(notifError),
        })
      })
    }
  }).catch((unexpected) => {
    // Top-level guardrail. The inner `.then(async () => ...)` body has its
    // own try/catch above, so reaching this branch means the promise pipeline
    // itself failed (extremely rare). Log so the operator can detect.
    logger.error('prototype.decision.accepted.side_effect_pipeline_failed', {
      decisionId: input.decisionId,
      ...errorToLogContext(unexpected),
    })
  })
}

/**
 * Synchronous business handler for `POST /api/integrations/website/prototype-decision`.
 * The route file owns HMAC verify + ledger claim + replay-path branching +
 * `markWebsiteWebhookEventProcessed`; this handler executes the persistence
 * flow once the route has accepted the request for processing.
 *
 * 8-step flow per spec §C-slice (handler):
 *   1. Token → workspace lookup (404 PROTOTYPE_DECISION_TOKEN_NOT_FOUND on miss).
 *   2. Defensive cross-check workspace_id matches resolved id
 *      (409 PROTOTYPE_DECISION_IDENTIFIER_MISMATCH on mismatch).
 *   3. Lifecycle checks: 410 PROTOTYPE_DECISION_TOKEN_EXPIRED if superseded;
 *      410 PROTOTYPE_DECISION_LEAD_DELETED if lead cascade left a stale row.
 *   4. Uniqueness check (409 PROTOTYPE_DECISION_ALREADY_DECIDED for conflicting
 *      NEW requests; bit-identical replay is handled by the route before reaching
 *      this handler).
 *   5. INSERT `prototype_decisions` row (500 PROTOTYPE_DECISION_PERSIST_FAILED on DB error).
 *   6. Return wire-shape (caller writes the response).
 *   7. On `decision === 'accepted'`, the CALLER schedules the Maxwell draft
 *      fire-and-forget via `scheduleAcceptedPrototypeDecisionSideEffects`.
 *   8. On `decision === 'rejected'`, this function inserts the seller
 *      notification synchronously (no draft side effect).
 */
export async function receiveWebsitePrototypeDecision(
  payload: WebsitePrototypeDecisionPayload,
  webhookEventId: string | null,
  clientOverride?: SupabaseAdminClient,
): Promise<ReceiveWebsitePrototypeDecisionResult> {
  const client = clientOverride ?? createSupabaseAdminClient()

  // Step 1 — resolve token.
  const workspace = await resolvePrototypeWorkspaceByShareToken(client, payload.token)

  if (!workspace) {
    throw new NotFoundApiError(
      'No prototype workspace matches the supplied share token.',
      'PROTOTYPE_DECISION_TOKEN_NOT_FOUND',
    )
  }

  // Step 2 — defensive cross-check.
  if (workspace.id !== payload.prototype_workspace_id) {
    logger.warn('prototype.decision.identifier_mismatch', {
      resolvedWorkspaceId: workspace.id,
      payloadWorkspaceId: payload.prototype_workspace_id,
      leadId: workspace.lead_id,
    })
    throw new ConflictApiError(
      'The supplied prototype_workspace_id does not match the workspace resolved from the token.',
      'PROTOTYPE_DECISION_IDENTIFIER_MISMATCH',
    )
  }

  // Step 3a — superseded token.
  if (workspace.share_token_superseded_at !== null) {
    throw new ApiError(
      'PROTOTYPE_DECISION_TOKEN_EXPIRED',
      'This prototype share token has been superseded by a newer iteration.',
      410,
    )
  }

  // Step 3b — defensive lead-deleted check (FK cascade should have removed
  // the workspace too, but the cascade race is possible).
  if (await leadIsHardDeleted(client, workspace.lead_id)) {
    throw new ApiError(
      'PROTOTYPE_DECISION_LEAD_DELETED',
      'The lead this prototype belonged to no longer exists.',
      410,
    )
  }

  // Step 4 — uniqueness check.
  const existingDecision = await findExistingPrototypeDecision(client, workspace.id)
  if (existingDecision) {
    throw new ConflictApiError(
      'This prototype workspace already has a recorded terminal decision.',
      'PROTOTYPE_DECISION_ALREADY_DECIDED',
    )
  }

  // Step 5 — INSERT.
  const clientUserAgent = payload.client?.user_agent?.trim() ?? null
  const trimmedNotes = payload.notes?.trim() ?? null
  const decisionRow = await insertPrototypeDecisionRow(client, {
    prototypeWorkspaceId: workspace.id,
    leadId: workspace.lead_id,
    decision: payload.decision,
    notes: trimmedNotes && trimmedNotes.length > 0 ? trimmedNotes : null,
    clientUserAgent,
    webhookEventId,
  })

  // Step 8 — reject path: inline seller notification (no draft side effect).
  if (payload.decision === 'rejected') {
    await insertSellerPrototypeDecisionNotification(client, {
      sellerProfileId: workspace.requested_by_profile_id,
      decisionId: decisionRow.id,
      decision: 'rejected',
      draftStatus: 'not_applicable',
      truncatedNotes: truncateNotesForNotification(trimmedNotes),
      leadId: workspace.lead_id,
    })
  }

  return {
    idempotent: false,
    decisionId: decisionRow.id,
    prototypeWorkspaceId: workspace.id,
    leadId: workspace.lead_id,
    decision: payload.decision,
    decidedAt: decisionRow.decided_at,
    draftPropuestaQueued: payload.decision === 'accepted',
    sellerProfileId: workspace.requested_by_profile_id,
  }
}

export async function listInboundPmQueue() {
  const client = createSupabaseAdminClient()
  const { data, error } = await table(client, 'website_inbound_links')
    .select(
      `
        id,
        external_source,
        external_session_id,
        external_proposal_id,
        external_payment_id,
        current_status,
        review_webhook_status,
        review_webhook_error,
        inbound_payload,
        created_at,
        updated_at,
        lead:leads(id, name, email, company, status, value, created_at),
        proposal:lead_proposals(id, title, body, amount, currency, status, review_status, reviewed_at, payment_status, paid_at, created_at),
        project:projects(id, name, status, created_at)
      `
    )
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    throw new ApiError('INBOUND_PM_QUEUE_FAILED', error.message, 500)
  }

  return data ?? []
}

// ----------------------------------------------------------------------------
// G22 — GET /api/integrations/website/prototype-signed-read/[token]
// Per ADR-024 + cross-repo-webhook-v1.md §6 + spec
// fase-3-g22-prototype-signed-read-handler-impl.
// ----------------------------------------------------------------------------

// Inline humanization map per spec §"Project-type label derivation" + ADR-024
// §Amendments A1 (OQ-1 resolution). Small / closed; <=5 expected values. A
// future iteration may extract to `lib/maxwell/project-type-labels.ts` if the
// table grows or requires localization.
const PROTOTYPE_PROJECT_TYPE_LABELS: Record<string, string> = {
  landing: 'Landing Page',
  landing_page: 'Landing Page',
  webapp: 'Web App',
  web_app: 'Web App',
  ecommerce: 'E-commerce',
  e_commerce: 'E-commerce',
  sitio_web: 'Sitio Web',
  website: 'Sitio Web',
}

function humanizePrototypeProjectType(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return 'Sitio Web'
  return PROTOTYPE_PROJECT_TYPE_LABELS[raw.trim().toLowerCase()] ?? 'Sitio Web'
}

function extractMaxwellProjectType(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const value = (snapshot as Record<string, unknown>).project_type
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

// Cache header values are byte-exact per ADR-024 D7 / AC-9. Do not mutate.
const PROTOTYPE_SIGNED_READ_CACHE_CONTROL_OK =
  'private, max-age=30, stale-while-revalidate=60'
const PROTOTYPE_SIGNED_READ_CACHE_CONTROL_ERROR = 'no-store'

export interface PrototypeSignedReadSuccessBody {
  data: {
    workspace: {
      id: string
      version: number
      generatedAt: string
    }
    leadContext: {
      businessName: string
      projectTypeLabel: string
    }
    prototype: {
      deployedUrl: string | null
      generatedHtml: string | null
    }
    decision: {
      status: 'pending' | 'accepted' | 'rejected'
      notes: string | null
      decidedAt: string | null
    }
    lifecycle: {
      tokenSuperseded: boolean
      iterationNumber: number
    }
    serverTime: string
  }
}

export interface PrototypeSignedReadErrorBody {
  error: string
  code: 'PROTOTYPE_READ_TOKEN_NOT_FOUND' | 'PROTOTYPE_READ_TOKEN_SUPERSEDED' | 'PROTOTYPE_READ_LEAD_DELETED' | 'PROTOTYPE_READ_INTERNAL_FAILED'
}

export type PrototypeSignedReadServeResult =
  | {
      kind: 'ok'
      status: 200
      cacheControl: typeof PROTOTYPE_SIGNED_READ_CACHE_CONTROL_OK
      body: PrototypeSignedReadSuccessBody
      log: {
        level: 'info'
        event: 'website.prototype_signed_read.served'
        fields: {
          workspaceId: string
          decisionStatus: 'pending' | 'accepted' | 'rejected'
          workspaceVersion: number
        }
      }
    }
  | {
      kind: 'error'
      status: 404 | 410 | 500
      cacheControl: typeof PROTOTYPE_SIGNED_READ_CACHE_CONTROL_ERROR
      body: PrototypeSignedReadErrorBody
      log: {
        level: 'warn'
        event: 'website.prototype_signed_read.rejected'
        fields: {
          code: PrototypeSignedReadErrorBody['code']
          tokenPrefix: string
        }
      }
    }

/**
 * Synchronous business handler for `GET /api/integrations/website/prototype-signed-read/[token]`.
 *
 * The route file owns HMAC verify + rate-limit + response wrapping (NextResponse
 * + `x-request-id` + `Cache-Control` header). This helper owns lifecycle
 * resolution and the response-body construction via the positive allowlist
 * (ADR-024 D4 §"Sanitization") — no `{ ...workspaceRow }` spreads, every field
 * is named explicitly.
 *
 * Lifecycle check order per ADR-024 D2 §"Tombstone case":
 *   1. Token resolves to workspace row? Otherwise `404 PROTOTYPE_READ_TOKEN_NOT_FOUND`.
 *   2. Parent `leads` row missing on the join? `410 PROTOTYPE_READ_LEAD_DELETED`.
 *   3. `share_token_superseded_at` non-null? `410 PROTOTYPE_READ_TOKEN_SUPERSEDED`.
 *   4. Compute version + build response.
 */
export async function serveWebsitePrototypeSignedRead(
  token: string,
  clientOverride?: SupabaseAdminClient,
): Promise<PrototypeSignedReadServeResult> {
  const client = clientOverride ?? createSupabaseAdminClient()
  const tokenPrefix = token.slice(0, 8)

  let row: PrototypeSignedReadRow | null
  try {
    row = await getPrototypeWorkspaceByShareToken(client, token)
  } catch (err) {
    logger.error('website.prototype_signed_read.lookup_failed', {
      tokenPrefix,
      ...errorToLogContext(err),
    })
    return {
      kind: 'error',
      status: 500,
      cacheControl: PROTOTYPE_SIGNED_READ_CACHE_CONTROL_ERROR,
      body: {
        error: 'Internal server error resolving prototype share token.',
        code: 'PROTOTYPE_READ_INTERNAL_FAILED',
      },
      log: {
        level: 'warn',
        event: 'website.prototype_signed_read.rejected',
        fields: { code: 'PROTOTYPE_READ_INTERNAL_FAILED', tokenPrefix },
      },
    }
  }

  if (!row) {
    return {
      kind: 'error',
      status: 404,
      cacheControl: PROTOTYPE_SIGNED_READ_CACHE_CONTROL_ERROR,
      body: {
        error: 'No prototype matches the supplied share token.',
        code: 'PROTOTYPE_READ_TOKEN_NOT_FOUND',
      },
      log: {
        level: 'warn',
        event: 'website.prototype_signed_read.rejected',
        fields: { code: 'PROTOTYPE_READ_TOKEN_NOT_FOUND', tokenPrefix },
      },
    }
  }

  if (!row.lead) {
    return {
      kind: 'error',
      status: 410,
      cacheControl: PROTOTYPE_SIGNED_READ_CACHE_CONTROL_ERROR,
      body: {
        error: 'The prototype is no longer available.',
        code: 'PROTOTYPE_READ_LEAD_DELETED',
      },
      log: {
        level: 'warn',
        event: 'website.prototype_signed_read.rejected',
        fields: { code: 'PROTOTYPE_READ_LEAD_DELETED', tokenPrefix },
      },
    }
  }

  if (row.workspace.share_token_superseded_at !== null) {
    return {
      kind: 'error',
      status: 410,
      cacheControl: PROTOTYPE_SIGNED_READ_CACHE_CONTROL_ERROR,
      body: {
        error: 'This prototype has been replaced by a newer version.',
        code: 'PROTOTYPE_READ_TOKEN_SUPERSEDED',
      },
      log: {
        level: 'warn',
        event: 'website.prototype_signed_read.rejected',
        fields: { code: 'PROTOTYPE_READ_TOKEN_SUPERSEDED', tokenPrefix },
      },
    }
  }

  // 200 path — compute version + build response via positive allowlist.
  let version: number
  try {
    version = await countPrototypeWorkspaceVersionForLead(
      client,
      row.lead.id,
      row.workspace.id,
    )
  } catch (err) {
    logger.error('website.prototype_signed_read.version_count_failed', {
      tokenPrefix,
      workspaceId: row.workspace.id,
      ...errorToLogContext(err),
    })
    return {
      kind: 'error',
      status: 500,
      cacheControl: PROTOTYPE_SIGNED_READ_CACHE_CONTROL_ERROR,
      body: {
        error: 'Internal server error resolving prototype iteration number.',
        code: 'PROTOTYPE_READ_INTERNAL_FAILED',
      },
      log: {
        level: 'warn',
        event: 'website.prototype_signed_read.rejected',
        fields: { code: 'PROTOTYPE_READ_INTERNAL_FAILED', tokenPrefix },
      },
    }
  }

  const businessName = row.lead.company ?? row.lead.name
  const projectTypeLabel = humanizePrototypeProjectType(
    extractMaxwellProjectType(row.lead.maxwell_snapshot),
  )

  const decisionStatus: 'pending' | 'accepted' | 'rejected' =
    row.decision === null
      ? 'pending'
      : row.decision.decision === 'accepted'
        ? 'accepted'
        : 'rejected'

  // Sanitizer rule per ADR-024 D3: `decision.notes` is non-null ONLY when
  // status === 'rejected' AND the row has a notes value. Even if 'accepted'
  // rows carried a notes value, we strip it here.
  const decisionNotes =
    decisionStatus === 'rejected' && row.decision !== null ? row.decision.notes : null
  const decisionDecidedAt =
    decisionStatus !== 'pending' && row.decision !== null ? row.decision.decided_at : null

  const body: PrototypeSignedReadSuccessBody = {
    data: {
      workspace: {
        id: row.workspace.id,
        version,
        generatedAt: row.workspace.created_at,
      },
      leadContext: {
        businessName,
        projectTypeLabel,
      },
      prototype: {
        deployedUrl: row.workspace.demo_url,
        generatedHtml: row.workspace.generated_content,
      },
      decision: {
        status: decisionStatus,
        notes: decisionNotes,
        decidedAt: decisionDecidedAt,
      },
      lifecycle: {
        tokenSuperseded: row.workspace.share_token_superseded_at !== null,
        iterationNumber: version,
      },
      serverTime: new Date().toISOString(),
    },
  }

  return {
    kind: 'ok',
    status: 200,
    cacheControl: PROTOTYPE_SIGNED_READ_CACHE_CONTROL_OK,
    body,
    log: {
      level: 'info',
      event: 'website.prototype_signed_read.served',
      fields: {
        workspaceId: row.workspace.id,
        decisionStatus,
        workspaceVersion: version,
      },
    },
  }
}
