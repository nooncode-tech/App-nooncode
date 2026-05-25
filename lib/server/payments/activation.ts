import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/server/supabase/database.types'

type DatabaseClient = SupabaseClient<Database>

export interface PaymentActivationResult {
  payment_id: string
  proposal_id: string
  lead_id: string
  project_id: string
  activated_now: boolean
  payment_was_already_succeeded: boolean
}

function mapActivationRpcError(error: { message?: string } | null): Error {
  const message = error?.message ?? 'Payment activation failed.'

  if (message.includes('PAYMENT_NOT_FOUND')) return new Error('PAYMENT_NOT_FOUND')
  if (message.includes('PROPOSAL_NOT_FOUND')) return new Error('PROPOSAL_NOT_FOUND')
  if (message.includes('PROPOSAL_REQUIRES_PM_APPROVAL')) return new Error('PROPOSAL_REQUIRES_PM_APPROVAL')
  if (message.includes('LEAD_NOT_FOUND')) return new Error('LEAD_NOT_FOUND')

  return new Error(message)
}

export async function activatePaidProposal(
  client: DatabaseClient,
  input: {
    paymentId: string
    providerPaymentIntentId?: string | null
    paidAt?: string | null
    actorProfileId?: string | null
    metadata?: Json
    projectDescription?: string | null
  }
): Promise<PaymentActivationResult> {
  const { data, error } = await client.rpc('activate_paid_proposal', {
    p_payment_id: input.paymentId,
    p_provider_payment_intent_id: input.providerPaymentIntentId ?? undefined,
    p_paid_at: input.paidAt ?? new Date().toISOString(),
    p_actor_profile_id: input.actorProfileId ?? undefined,
    p_payment_metadata: input.metadata ?? {},
    p_project_description: input.projectDescription ?? undefined,
  })

  if (error) {
    throw mapActivationRpcError(error)
  }

  const row = Array.isArray(data) ? data[0] : data

  if (!row) {
    throw new Error('PAYMENT_ACTIVATION_RETURNED_NO_DATA')
  }

  return row as PaymentActivationResult
}
