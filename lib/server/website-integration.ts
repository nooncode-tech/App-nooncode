import { z } from 'zod'

import { ApiError, ConflictApiError, NotFoundApiError } from '@/lib/server/api/errors'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import {
  getProposalReviewDecisionWebhookUrl,
  signWebsitePayload,
} from '@/lib/server/website-webhook-auth'

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
    projectId: string
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
      project_id: input.projectId,
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

async function ensureProjectForPaidInboundProposal(
  client: SupabaseAdminClient,
  link: WebsiteInboundLinkRow,
  payload: WebsitePaymentConfirmedPayload
) {
  if (link.project_id) {
    return link.project_id
  }

  const { data: proposal, error: proposalError } = await table(client, 'lead_proposals')
    .select('id, title, body, amount, currency, lead_id, review_status')
    .eq('id', link.proposal_id)
    .single()

  if (proposalError || !proposal) {
    throw new NotFoundApiError('Inbound proposal was not found.', 'INBOUND_PROPOSAL_NOT_FOUND')
  }

  if (proposal.review_status !== 'approved') {
    throw new ConflictApiError(
      'Inbound payment cannot activate a project before PM approval.',
      'INBOUND_PAYMENT_REQUIRES_PM_APPROVAL'
    )
  }

  const { data: existingProject, error: existingProjectError } = await table(client, 'projects')
    .select('id')
    .eq('source_proposal_id', link.proposal_id)
    .maybeSingle()

  if (existingProjectError) {
    throw new ApiError('INBOUND_PROJECT_LOOKUP_FAILED', existingProjectError.message, 500)
  }

  if (existingProject?.id) {
    return existingProject.id as string
  }

  const { data: lead, error: leadError } = await table(client, 'leads')
    .select('id, name, company')
    .eq('id', link.lead_id)
    .single()

  if (leadError || !lead) {
    throw new NotFoundApiError('Inbound lead was not found.', 'INBOUND_LEAD_NOT_FOUND')
  }

  const actorId = await resolveIntegrationActorId(client)
  const paidAt = payload.payment?.paid_at ?? new Date().toISOString()
  const amount = payload.payment?.amount ?? payload.proposal?.amount ?? proposal.amount

  const { data: project, error: projectError } = await table(client, 'projects')
    .insert({
      source_lead_id: link.lead_id,
      source_proposal_id: link.proposal_id,
      created_by: actorId,
      name: payload.proposal?.title ?? proposal.title,
      description: buildProjectDescription(payload, proposal),
      client_name: payload.customer?.company ?? payload.customer?.name ?? lead.company ?? lead.name,
      status: 'backlog',
      budget: amount,
      team_legacy_user_ids: [],
      pm_legacy_user_id: null,
      handoff_ready_at: paidAt,
      payment_activated: true,
      payment_activated_at: paidAt,
    })
    .select('id')
    .single()

  if (projectError || !project?.id) {
    throw new ApiError('INBOUND_PROJECT_CREATE_FAILED', projectError?.message ?? 'Project was not created.', 500)
  }

  return project.id as string
}

export async function receiveWebsitePaymentConfirmed(payload: WebsitePaymentConfirmedPayload) {
  const client = createSupabaseAdminClient()
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

  const projectId = await ensureProjectForPaidInboundProposal(client, link, payload)
  const paidAt = payload.payment?.paid_at ?? new Date().toISOString()
  const { data: proposalForPayment, error: proposalPaymentError } = await table(client, 'lead_proposals')
    .select('amount, currency')
    .eq('id', link.proposal_id)
    .single()

  if (proposalPaymentError || !proposalForPayment) {
    throw new NotFoundApiError('Inbound proposal was not found.', 'INBOUND_PROPOSAL_NOT_FOUND')
  }

  await createPaymentRecordIfMissing(client, {
    proposalId: link.proposal_id,
    projectId,
    amount: payload.payment?.amount ?? payload.proposal?.amount ?? proposalForPayment.amount,
    currency: payload.payment?.currency ?? payload.proposal?.currency ?? proposalForPayment.currency,
    paidAt,
    externalPaymentId: payload.external_payment_id,
    payload,
  })

  const [{ error: proposalError }, { error: leadError }, { error: linkError }] = await Promise.all([
    table(client, 'lead_proposals')
      .update({
        status: 'handoff_ready',
        review_status: 'approved',
        payment_status: 'succeeded',
        paid_at: paidAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', link.proposal_id),
    table(client, 'leads')
      .update({
        status: 'won',
        updated_at: new Date().toISOString(),
      })
      .eq('id', link.lead_id),
    table(client, 'website_inbound_links')
      .update({
        external_payment_id: payload.external_payment_id,
        project_id: projectId,
        current_status: 'project_activated',
        payment_confirmed_at: paidAt,
        payment_payload: payload,
      })
      .eq('id', link.id),
  ])

  if (proposalError) throw new ApiError('INBOUND_PROPOSAL_PAYMENT_UPDATE_FAILED', proposalError.message, 500)
  if (leadError) throw new ApiError('INBOUND_LEAD_PAYMENT_UPDATE_FAILED', leadError.message, 500)
  if (linkError) throw new ApiError('INBOUND_LINK_PAYMENT_UPDATE_FAILED', linkError.message, 500)

  return {
    idempotent: Boolean(link.project_id || link.external_payment_id),
    linkId: link.id,
    leadId: link.lead_id,
    proposalId: link.proposal_id,
    projectId,
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
    .select('id, title, body, amount, currency, review_status, reviewed_at, lead:leads(id, name, email, company)')
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
