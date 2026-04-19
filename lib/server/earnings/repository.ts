import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'

type DatabaseClient = SupabaseClient<Database>

const earningSelect = `
  id,
  actor_id,
  actor_role,
  earning_type,
  amount,
  currency,
  lead_id,
  proposal_id,
  payment_id,
  status,
  credited_at,
  paid_out_at,
  notes,
  created_at,
  lead:leads!earnings_ledger_lead_id_fkey(name, company),
  proposal:lead_proposals!earnings_ledger_proposal_id_fkey(title, amount)
`

export async function listEarningsForActor(
  client: DatabaseClient,
  actorId: string,
) {
  const { data, error } = await client
    .from('earnings_ledger')
    .select(earningSelect)
    .eq('actor_id', actorId)
    .order('credited_at', { ascending: false })

  if (error) throw new Error(`Failed to list earnings: ${error.message}`)

  return data ?? []
}

export async function listAllEarnings(client: DatabaseClient) {
  const { data, error } = await client
    .from('earnings_ledger')
    .select(earningSelect)
    .order('credited_at', { ascending: false })

  if (error) throw new Error(`Failed to list all earnings: ${error.message}`)

  return data ?? []
}

export async function getEarningsSummaryForActor(
  client: DatabaseClient,
  actorId: string,
) {
  const { data, error } = await client
    .from('earnings_ledger')
    .select('amount, status, earning_type')
    .eq('actor_id', actorId)

  if (error) throw new Error(`Failed to get earnings summary: ${error.message}`)

  const rows = data ?? []

  const totalCredited = rows
    .filter((r) => r.status === 'credited' || r.status === 'paid_out')
    .reduce((sum, r) => sum + Number(r.amount), 0)

  const pendingPayout = rows
    .filter((r) => r.status === 'credited')
    .reduce((sum, r) => sum + Number(r.amount), 0)

  const paidOut = rows
    .filter((r) => r.status === 'paid_out')
    .reduce((sum, r) => sum + Number(r.amount), 0)

  const activationTotal = rows
    .filter((r) => r.earning_type === 'activation')
    .reduce((sum, r) => sum + Number(r.amount), 0)

  const monthlyTotal = rows
    .filter((r) => r.earning_type === 'monthly')
    .reduce((sum, r) => sum + Number(r.amount), 0)

  return { totalCredited, pendingPayout, paidOut, activationTotal, monthlyTotal }
}
