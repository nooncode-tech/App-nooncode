import { openai } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/lib/server/api/logger'
import { computePricing, type Complexity, type ProjectType } from '@/lib/maxwell/pricing'
import type { Database } from '@/lib/server/supabase/database.types'

type DatabaseClient = SupabaseClient<Database>

/**
 * Maxwell draft helper for the post-accept fire-and-forget side effect on the
 * `prototype-decision` webhook (ADR-023 §5.8 + ADR-023 D6, ADR-013 D9).
 *
 * Behavior contract per ADR-023 D9 + spec AC-8:
 *   - Inserts ONE `lead_proposals` row populating `title`, `body`,
 *     `project_type`, `complexity` (the four LLM-inferable fields).
 *   - Sets `amount = computePricing(projectType, complexity, 'outbound', 0).activationBase`
 *     — the placeholder value. The seller picks the fee in a follow-up UI
 *     iteration; at submit-to-PM time `assertOutboundProposalAmountMatchesPricing`
 *     enforces `amount = base + sellerFee` (ADR-013 invariant).
 *   - Does NOT create a `seller_fees` row. Per ADR-013, the seller is the
 *     only writer of that row.
 *   - On failure: throws. The caller logs `prototype.decision.accepted.draft_creation_failed`
 *     and escalates the seller notification copy. No automatic retry.
 *
 * @see docs/adrs/ADR-023-prototype-decision-cross-repo-contract.md §D6, §D9
 * @see docs/adrs/ADR-013-seller-fee-additive-pricing.md
 * @see lib/server/leads/proposal-amount-validation.ts (the submit-to-PM gate
 *      that enforces the invariant once the seller has picked the fee).
 */

const draftSchema = z.object({
  projectType: z.enum(['landing', 'ecommerce', 'webapp', 'mobile', 'saas_ai']),
  complexity: z.enum(['low', 'medium', 'high']),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(20).max(4000),
})

type Draft = z.infer<typeof draftSchema>

export interface PrototypeDecisionDraftInput {
  /** Always service-role per ADR-023 D6 / cross-repo §5 (HMAC-authed, no user). */
  client: DatabaseClient
  leadId: string
  /**
   * The `requested_by_profile_id` of the workspace whose decision was
   * accepted. Becomes the `lead_proposals.created_by` so the seller can
   * find the draft in their own queue.
   */
  sellerProfileId: string
  /** Forensic linkage for log lines. */
  prototypeWorkspaceId: string
  decisionId: string
}

export interface PrototypeDecisionDraftResult {
  proposalId: string
  projectType: ProjectType
  complexity: Complexity
  amount: number
}

interface LeadContext {
  id: string
  name: string
  company: string | null
  notes: string | null
  source: string
  tags: string[]
  maxwell_snapshot: unknown
}

async function fetchLeadContext(
  client: DatabaseClient,
  leadId: string,
): Promise<LeadContext> {
  const { data, error } = await client
    .from('leads')
    .select('id, name, company, notes, source, tags, maxwell_snapshot')
    .eq('id', leadId)
    .single()

  if (error || !data) {
    throw new Error(
      `Could not load lead ${leadId} for prototype-decision draft: ${error?.message ?? 'lead not found'}`,
    )
  }

  return {
    id: data.id,
    name: data.name,
    company: data.company,
    notes: data.notes,
    source: data.source,
    tags: data.tags ?? [],
    maxwell_snapshot: data.maxwell_snapshot,
  }
}

function isMaxwellAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim())
}

/**
 * Heuristic fallback used when OPENAI_API_KEY is not configured (dev / test
 * environments) OR when the LLM call fails. The chosen defaults are
 * deliberately conservative — `webapp` / `medium` lands in the middle of the
 * pricing matrix, so the seller is least surprised on UI review. The seller
 * MUST adjust before submit-to-PM regardless of how the draft was generated.
 */
function heuristicDraft(lead: LeadContext): Draft {
  const trimmedNotes = (lead.notes ?? '').trim()
  const snippet = trimmedNotes.slice(0, 240)
  return {
    projectType: 'webapp',
    complexity: 'medium',
    title: `Propuesta para ${lead.company ?? lead.name}`,
    body:
      `Borrador automático generado tras aceptación del prototipo.\n\n` +
      `Cliente: ${lead.name}${lead.company ? ` (${lead.company})` : ''}.\n` +
      (snippet ? `Contexto inicial: ${snippet}\n\n` : '\n') +
      `Por favor revisá esta propuesta, ajustá el alcance + complejidad y elegí ` +
      `tu seller fee antes de enviarla a PM review.`,
  }
}

async function inferDraftViaLlm(lead: LeadContext): Promise<Draft> {
  const { object } = await generateObject({
    model: openai('gpt-4o-mini'),
    schema: draftSchema,
    system:
      `Sos Maxwell, copiloto de NoonApp para sellers outbound. ` +
      `Tu tarea es producir un borrador de propuesta comercial para un lead que ` +
      `acaba de aceptar un prototipo. ` +
      `Devolvé un JSON con projectType, complexity, title y body. ` +
      `El title debe ser conciso (≤120 chars), claro, sin marketing agresivo. ` +
      `El body debe describir el alcance propuesto en español neutro, en 3-6 ` +
      `párrafos cortos: contexto del cliente, problema observado, solución ` +
      `propuesta, próximos pasos. No menciones precios ni montos. ` +
      `El seller revisará y editará antes de enviar a PM review.`,
    prompt: JSON.stringify({
      lead: {
        name: lead.name,
        company: lead.company,
        notes: lead.notes,
        source: lead.source,
        tags: lead.tags,
        maxwellSnapshot: lead.maxwell_snapshot,
      },
      pricingMatrix: {
        projectType: ['landing', 'ecommerce', 'webapp', 'mobile', 'saas_ai'],
        complexity: ['low', 'medium', 'high'],
      },
      instruction:
        'Elegí projectType y complexity del menú que mejor describa el alcance que el prototipo aceptado sugiere.',
    }),
  })

  return object
}

export async function createPrototypeDecisionDraft(
  input: PrototypeDecisionDraftInput,
): Promise<PrototypeDecisionDraftResult> {
  const lead = await fetchLeadContext(input.client, input.leadId)

  let draft: Draft
  try {
    draft = isMaxwellAiConfigured() ? await inferDraftViaLlm(lead) : heuristicDraft(lead)
  } catch (llmError) {
    // LLM call failed: fall back to heuristic. The caller is still notified
    // of the underlying error via the structured log line; we do not throw
    // here because a draft with placeholder content is still a useful seed
    // for the seller (better than no draft at all → manual "create from
    // scratch" path).
    logger.warn('prototype.decision.draft.llm_failed_using_heuristic', {
      leadId: input.leadId,
      prototypeWorkspaceId: input.prototypeWorkspaceId,
      decisionId: input.decisionId,
      errorMessage: llmError instanceof Error ? llmError.message : String(llmError),
    })
    draft = heuristicDraft(lead)
  }

  // ADR-023 D9: amount is the activation BASE (no seller fee yet). Seller
  // picks fee in a follow-up UI iteration; submit-to-PM validator enforces
  // `amount = base + sellerFee` per ADR-013.
  const pricing = computePricing(draft.projectType, draft.complexity, 'outbound', 0)
  const placeholderAmount = pricing.activationBase

  const { data: inserted, error: insertError } = await input.client
    .from('lead_proposals')
    .insert({
      lead_id: input.leadId,
      created_by: input.sellerProfileId,
      title: draft.title,
      body: draft.body,
      amount: placeholderAmount,
      currency: 'USD',
      status: 'draft',
      review_status: 'pending_review',
      payment_status: null,
      is_special_case: false,
      project_type: draft.projectType,
      complexity: draft.complexity,
    })
    .select('id')
    .single()

  if (insertError || !inserted?.id) {
    throw new Error(
      `Failed to insert prototype-decision Maxwell draft proposal for lead ${input.leadId}: ${
        insertError?.message ?? 'no row returned'
      }`,
    )
  }

  return {
    proposalId: inserted.id,
    projectType: draft.projectType,
    complexity: draft.complexity,
    amount: placeholderAmount,
  }
}
