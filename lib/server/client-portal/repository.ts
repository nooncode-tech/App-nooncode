import type { SupabaseClient } from '@supabase/supabase-js'

export async function createClientToken(
  client: SupabaseClient,
  projectId: string,
  leadId: string | null,
  clientName: string | null,
  clientEmail: string | null,
  createdBy: string,
  expiresAt: string | null,
) {
  const { data, error } = await client
    .from('client_access_tokens')
    .insert({
      project_id: projectId,
      lead_id: leadId,
      client_name: clientName,
      client_email: clientEmail,
      created_by: createdBy,
      expires_at: expiresAt,
    })
    .select('id, token, project_id, client_name, client_email, expires_at, created_at')
    .single()

  if (error) throw new Error(`Failed to create client token: ${error.message}`)
  return data
}

export async function listClientTokensForProject(
  client: SupabaseClient,
  projectId: string,
) {
  const { data, error } = await client
    .from('client_access_tokens')
    .select('id, token, client_name, client_email, expires_at, last_accessed_at, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list client tokens: ${error.message}`)
  return data ?? []
}

export async function resolveClientToken(
  client: SupabaseClient,
  token: string,
) {
  const { data, error } = await client
    .rpc('resolve_client_token', { p_token: token })

  if (error) throw new Error(`Failed to resolve token: ${error.message}`)

  const rows = data as Array<{
    token_id: string
    project_id: string
    project_name: string
    project_status: string
    client_name: string | null
    client_email: string | null
    lead_id: string | null
    proposal_id: string | null
    proposal_title: string | null
    proposal_amount: number | null
    payment_status: string | null
    payment_activated: boolean
  }>

  return rows?.[0] ?? null
}
