import type { SupabaseClient } from '@supabase/supabase-js'

export async function getPointsBalance(
  client: SupabaseClient,
  actorId: string,
): Promise<number> {
  const { data, error } = await client
    .from('points_ledger')
    .select('points')
    .eq('actor_id', actorId)

  if (error) throw new Error(`Failed to get points balance: ${error.message}`)
  return (data ?? []).reduce((sum, r) => sum + Number(r.points), 0)
}

export async function listPointsLedger(
  client: SupabaseClient,
  actorId: string,
) {
  const { data, error } = await client
    .from('points_ledger')
    .select('id, event_type, points, reference_id, notes, created_at')
    .eq('actor_id', actorId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list points ledger: ${error.message}`)
  return data ?? []
}

export async function awardPoints(
  client: SupabaseClient,
  actorId: string,
  eventType: 'lead_won' | 'payment_received' | 'project_milestone' | 'manual_grant',
  points: number,
  referenceId: string | null,
  notes: string,
) {
  const { error } = await client
    .from('points_ledger')
    .insert({ actor_id: actorId, event_type: eventType, points, reference_id: referenceId, notes })

  if (error) throw new Error(`Failed to award points: ${error.message}`)
}

export async function listRewardStoreItems(client: SupabaseClient) {
  const { data, error } = await client
    .from('reward_store_items')
    .select('id, name, description, category, points_cost, stock')
    .eq('is_active', true)
    .order('points_cost', { ascending: true })

  if (error) throw new Error(`Failed to list reward store items: ${error.message}`)
  return data ?? []
}

export async function redeemReward(
  client: SupabaseClient,
  actorId: string,
  itemId: string,
) {
  // Load item
  const { data: item, error: itemError } = await client
    .from('reward_store_items')
    .select('id, name, points_cost, stock')
    .eq('id', itemId)
    .eq('is_active', true)
    .maybeSingle()

  if (itemError || !item) throw new Error('Reward item not found')

  // Check balance
  const balance = await getPointsBalance(client, actorId)
  if (balance < item.points_cost) {
    throw new Error(`Insufficient points. Balance: ${balance}, Required: ${item.points_cost}`)
  }

  // Check stock
  if (item.stock !== null && item.stock <= 0) {
    throw new Error('This reward is out of stock')
  }

  // Insert redemption record
  const { data: redemption, error: redemptionError } = await client
    .from('point_redemptions')
    .insert({ actor_id: actorId, item_id: itemId, points_used: item.points_cost })
    .select('id')
    .single()

  if (redemptionError || !redemption) throw new Error('Failed to create redemption record')

  // Deduct points from ledger
  const { error: ledgerError } = await client
    .from('points_ledger')
    .insert({
      actor_id: actorId,
      event_type: 'redemption',
      points: -item.points_cost,
      reference_id: redemption.id,
      notes: `Canje: ${item.name}`,
    })

  if (ledgerError) throw new Error(`Failed to deduct points: ${ledgerError.message}`)

  // Decrement stock if limited
  if (item.stock !== null) {
    await client
      .from('reward_store_items')
      .update({ stock: item.stock - 1 })
      .eq('id', itemId)
  }

  return redemption
}
