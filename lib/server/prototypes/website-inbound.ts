import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import { getPrototypeWorkspaceByLeadId } from '@/lib/server/prototypes/repository'

type DatabaseClient = SupabaseClient<Database>

interface WebsiteMaxwellSnapshot {
  summary?: string | null
  session_url?: string | null
  prototype_url?: string | null
  prototype_versions?: Array<{
    label?: string | null
    url?: string | null
    version_number?: number | null
    v0_chat_id?: string | null
  }>
}

export function resolveWebsitePrototypeReference(maxwell: WebsiteMaxwellSnapshot): string | null {
  if (maxwell.prototype_url?.trim()) {
    return maxwell.prototype_url.trim()
  }

  const versionWithUrl = (maxwell.prototype_versions ?? []).find((version) => version.url?.trim())
  return versionWithUrl?.url?.trim() ?? null
}

export async function ensureWebsiteInboundPrototypeWorkspace(
  client: DatabaseClient,
  input: {
    leadId: string
    requestedByProfileId: string
    maxwell: WebsiteMaxwellSnapshot
  }
): Promise<{ created: boolean; workspaceId: string | null }> {
  const prototypeReference = resolveWebsitePrototypeReference(input.maxwell)

  if (!prototypeReference) {
    return { created: false, workspaceId: null }
  }

  const existing = await getPrototypeWorkspaceByLeadId(client, input.leadId)

  if (existing) {
    if (!existing.generated_content) {
      const { error } = await client
        .from('prototype_workspaces')
        .update({
          generated_content: prototypeReference,
          generated_at: new Date().toISOString(),
          generation_prompt: input.maxwell.summary ?? null,
          status: 'ready',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)

      if (error) {
        throw new Error(`Failed to update inbound prototype workspace: ${error.message}`)
      }
    }

    return { created: false, workspaceId: existing.id }
  }

  const now = new Date().toISOString()
  const { data, error } = await client
    .from('prototype_workspaces')
    .insert({
      lead_id: input.leadId,
      requested_by_profile_id: input.requestedByProfileId,
      current_stage: 'sales',
      status: 'ready',
      generation_prompt: input.maxwell.summary ?? null,
      generated_content: prototypeReference,
      generated_at: now,
      last_operation_id: randomUUID(),
    })
    .select('id')
    .single()

  if (error || !data?.id) {
    throw new Error(error?.message ?? 'Inbound prototype workspace was not created.')
  }

  return { created: true, workspaceId: data.id }
}
