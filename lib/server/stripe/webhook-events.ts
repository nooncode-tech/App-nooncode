import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import type { Database } from '@/lib/server/supabase/database.types'

type DatabaseClient = SupabaseClient<Database>
type StripeWebhookEventStatus = Database['public']['Tables']['stripe_webhook_events']['Row']['status']

function eventMetadata(event: Stripe.Event) {
  return {
    event_id: event.id,
    event_type: event.type,
    livemode: event.livemode,
    api_version: event.api_version ?? null,
  }
}

export async function beginStripeWebhookEvent(client: DatabaseClient, event: Stripe.Event) {
  const { data: existing, error: lookupError } = await client
    .from('stripe_webhook_events')
    .select('event_id, status, attempt_count')
    .eq('event_id', event.id)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed to inspect Stripe webhook event ledger: ${lookupError.message}`)
  }

  if (existing?.status === 'processed') {
    return { shouldProcess: false, status: existing.status }
  }

  const nextAttemptCount = (existing?.attempt_count ?? 0) + 1
  const updates = {
    ...eventMetadata(event),
    status: 'processing' as StripeWebhookEventStatus,
    attempt_count: nextAttemptCount,
    last_error: null,
    failed_at: null,
  }

  const { error } = existing
    ? await client
      .from('stripe_webhook_events')
      .update(updates)
      .eq('event_id', event.id)
    : await client
      .from('stripe_webhook_events')
      .insert(updates)

  if (error) {
    throw new Error(`Failed to record Stripe webhook event: ${error.message}`)
  }

  return { shouldProcess: true, status: updates.status }
}

export async function markStripeWebhookEventProcessed(client: DatabaseClient, eventId: string) {
  const { error } = await client
    .from('stripe_webhook_events')
    .update({
      status: 'processed',
      processed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('event_id', eventId)

  if (error) {
    throw new Error(`Failed to mark Stripe webhook event processed: ${error.message}`)
  }
}

export async function markStripeWebhookEventFailed(
  client: DatabaseClient,
  eventId: string,
  error: unknown
) {
  const message = error instanceof Error ? error.message : String(error)

  const { error: updateError } = await client
    .from('stripe_webhook_events')
    .update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      last_error: message.slice(0, 1000),
    })
    .eq('event_id', eventId)

  if (updateError) {
    throw new Error(`Failed to mark Stripe webhook event failed: ${updateError.message}`)
  }
}
