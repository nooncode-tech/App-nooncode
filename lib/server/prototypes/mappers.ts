import type {
  PrototypeWorkspaceListItemWire,
  PrototypeWorkspaceWire,
} from '@/lib/prototypes/serialization'
import type {
  PrototypeWorkspaceRow,
  PrototypeWorkspaceRowWithRelations,
} from '@/lib/server/prototypes/types'
import { buildPrototypeShareUrl } from '@/lib/server/prototypes/share-url'

// Surface the client-facing share URL only when the workspace is in `ready`
// (renderable prototipo) or `delivery_active` AND the token has not been
// superseded by a regenerated newer version. Pending-generation workspaces
// have a token by construction (RPC writes it pre-completion), but the iframe
// target (`demo_url`) is null until v0 returns — sharing a `pending_generation`
// URL would render an empty NoonWeb portal. Superseded tokens 410 on the
// signed-read fetch (per ADR-024 §6.6) and would surface an error page.
function resolvePrototypeShareFields(row: PrototypeWorkspaceRow): {
  shareToken: string | null
  shareUrl: string | null
} {
  const rowWithShare = row as PrototypeWorkspaceRow & {
    share_token: string | null
    share_token_superseded_at: string | null
  }
  const shareToken = rowWithShare.share_token ?? null
  const isSuperseded = rowWithShare.share_token_superseded_at !== null
  const isReady = row.status === 'ready' || row.status === 'delivery_active'
  const shareUrl = isReady && !isSuperseded ? buildPrototypeShareUrl(shareToken) : null
  return { shareToken, shareUrl }
}

export function mapPrototypeWorkspaceRowToWire(row: PrototypeWorkspaceRow): PrototypeWorkspaceWire {
  const { shareToken, shareUrl } = resolvePrototypeShareFields(row)
  return {
    id: row.id,
    leadId: row.lead_id,
    projectId: row.project_id,
    requestedByProfileId: row.requested_by_profile_id,
    currentStage: row.current_stage,
    status: row.status,
    lastOperationId: row.last_operation_id,
    generationPrompt: row.generation_prompt,
    generatedContent: row.generated_content,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sellerBrief: row.seller_brief ?? null,
    shareToken,
    shareUrl,
  }
}

export function mapPrototypeWorkspaceListItemRowToWire(
  row: PrototypeWorkspaceRowWithRelations
): PrototypeWorkspaceListItemWire {
  return {
    ...mapPrototypeWorkspaceRowToWire(row),
    leadName: row.lead?.name ?? 'Lead sin nombre',
    projectName: row.project?.name ?? null,
    requestedByName: row.requested_by?.full_name ?? 'Usuario desconocido',
    generatedAt: row.generated_at,
    generatedContent: row.generated_content,
    demoUrl: row.demo_url,
    chatUrl: row.chat_url,
  }
}
