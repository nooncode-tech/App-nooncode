import type { SupabaseClient } from '@supabase/supabase-js'

export class ClientTokenRevokeError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'ClientTokenRevokeError'
  }
}

export class ClientTokenRotateError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'ClientTokenRotateError'
  }
}

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

export async function revokeClientToken(
  client: SupabaseClient,
  tokenId: string,
): Promise<{ tokenId: string; revokedAt: string }> {
  const { data, error } = await client.rpc('revoke_client_token', { p_token_id: tokenId })

  if (error) {
    throw new ClientTokenRevokeError((error as { code?: string }).code ?? 'REVOKE_FAILED', (error as Error).message)
  }

  const row = (data as Array<{ token_id: string; revoked_at: string }> | null)?.[0]
  if (!row) {
    throw new ClientTokenRevokeError('NO_ROW', 'No row returned from revoke_client_token')
  }

  return { tokenId: row.token_id, revokedAt: row.revoked_at }
}

export async function rotateClientToken(
  client: SupabaseClient,
  tokenId: string,
  newExpiresAt: string | null,
): Promise<{
  newTokenId: string
  newToken: string
  oldTokenId: string
  oldRevokedAt: string
}> {
  const { data, error } = await client.rpc('rotate_client_token', {
    p_token_id: tokenId,
    p_new_expires_at: newExpiresAt,
  })

  if (error) {
    throw new ClientTokenRotateError((error as { code?: string }).code ?? 'ROTATE_FAILED', (error as Error).message)
  }

  const row = (data as Array<{
    new_token_id: string
    new_token: string
    old_token_id: string
    old_revoked_at: string
  }> | null)?.[0]

  if (!row) {
    throw new ClientTokenRotateError('NO_ROW', 'No row returned from rotate_client_token')
  }

  return {
    newTokenId: row.new_token_id,
    newToken: row.new_token,
    oldTokenId: row.old_token_id,
    oldRevokedAt: row.old_revoked_at,
  }
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
