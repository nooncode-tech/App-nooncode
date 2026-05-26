import { randomUUID } from 'node:crypto'
import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { getPhase1AAdminEnv } from '../lib/env'
import type { Database } from '../lib/server/supabase/database.types'
import { receiveWebsiteInboundProposal } from '../lib/server/website-integration'

loadEnvConfig(process.cwd())

interface ValidationResult {
  name: string
  ok: boolean
  detail: string
}

const results: ValidationResult[] = []

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`)
}

async function getAdminProfileId(admin: ReturnType<typeof createClient<Database>>) {
  const { data, error } = await admin
    .from('user_profiles')
    .select('id')
    .eq('role', 'admin')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (error || !data?.id) {
    throw new Error('No active admin profile found for validation.')
  }

  return data.id
}

async function validateHandoffReadyMigration(admin: ReturnType<typeof createClient<Database>>) {
  const env = getPhase1AAdminEnv()
  const suffix = randomUUID()
  const adminProfileId = await getAdminProfileId(admin)

  const { data: lead, error: leadError } = await admin
    .from('leads')
    .insert({
      name: `Handoff validation ${suffix.slice(0, 8)}`,
      email: `handoff-${suffix.slice(0, 8)}@example.com`,
      source: 'website',
      status: 'proposal',
      score: 70,
      value: 500,
      created_by: adminProfileId,
      tags: ['validation'],
      notes: 'Temporary handoff validation lead',
      lead_origin: 'inbound',
    })
    .select('id')
    .single()

  if (leadError || !lead?.id) {
    record('handoff-ready-migration', false, leadError?.message ?? 'Lead temp no creado.')
    return
  }

  const { data: project, error: projectError } = await admin
    .from('projects')
    .insert({
      source_lead_id: lead.id,
      created_by: adminProfileId,
      name: 'Validation project',
      description: 'Temporary validation project',
      client_name: 'Validation',
      status: 'backlog',
      budget: 500,
      pm_legacy_user_id: null,
      team_legacy_user_ids: [],
      handoff_ready_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (projectError || !project?.id) {
    await admin.from('leads').delete().eq('id', lead.id)
    record('handoff-ready-migration', false, projectError?.message ?? 'Project temp no creado.')
    return
  }

  const { data: workspace, error: workspaceError } = await admin
    .from('prototype_workspaces')
    .insert({
      lead_id: lead.id,
      project_id: project.id,
      requested_by_profile_id: adminProfileId,
      current_stage: 'sales',
      status: 'ready',
      generated_content: 'https://v0.dev/demo/handoff-validation',
      generated_at: new Date().toISOString(),
      last_operation_id: randomUUID(),
      share_token: randomUUID(),
    })
    .select('id, current_stage, status')
    .single()

  if (workspaceError || !workspace?.id) {
    await admin.from('projects').delete().eq('id', project.id)
    await admin.from('leads').delete().eq('id', lead.id)
    record('handoff-ready-migration', false, workspaceError?.message ?? 'Workspace temp no creado.')
    return
  }

  const cleanup = async () => {
    await admin.from('user_notifications').delete().eq('source_event_id', workspace.id)
    await admin.from('tasks').delete().eq('project_id', project.id)
    await admin.from('prototype_workspaces').delete().eq('id', workspace.id)
    await admin.from('projects').delete().eq('id', project.id)
    await admin.from('leads').delete().eq('id', lead.id)
  }

  const pmClient = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const password = process.env.NOON_SEED_DEFAULT_PASSWORD
  if (!password) {
    await cleanup()
    record('handoff-ready-migration', false, 'NOON_SEED_DEFAULT_PASSWORD requerido para autenticar PM en la validacion.')
    return
  }

  const { data: authData, error: authError } = await pmClient.auth.signInWithPassword({
    email: 'ana@noon.app',
    password,
  })

  if (authError || !authData.session) {
    await cleanup()
    record('handoff-ready-migration', false, `No se pudo autenticar PM: ${authError?.message ?? 'sin sesion'}`)
    return
  }

  const { data: handoffResult, error: handoffRpcError } = await pmClient.rpc(
    'handoff_prototype_workspace_to_delivery',
    { target_workspace_id: workspace.id }
  )

  if (handoffRpcError) {
    await cleanup()
    const needsMigration = handoffRpcError.message.includes('INVALID_PROTOTYPE_HANDOFF_STATE')
    record(
      'handoff-ready-migration',
      false,
      needsMigration
        ? 'La migracion 0059 no esta aplicada. Ejecuta supabase/migrations/0059_phase_18c_prototype_handoff_ready_status.sql en Supabase.'
        : handoffRpcError.message
    )
    return
  }

  const ok =
    handoffResult?.current_stage === 'delivery'
    && (handoffResult.status === 'delivery_active' || handoffResult.status === 'ready')

  await cleanup()
  record(
    'handoff-ready-migration',
    ok,
    ok
      ? 'Handoff acepta workspaces en ready y los mueve a delivery.'
      : `Handoff respondio pero con estado inesperado: ${handoffResult?.current_stage}/${handoffResult?.status}`
  )
}

async function validateWebsiteInboundPrototype(admin: ReturnType<typeof createClient<Database>>) {
  const suffix = randomUUID().slice(0, 8)
  const payload = {
    external_source: 'noon_website',
    external_session_id: `validation-session-${suffix}`,
    external_proposal_id: `validation-proposal-${suffix}`,
    customer: {
      name: `Validation Client ${suffix}`,
      email: `validation-${suffix}@example.com`,
      phone: null,
      whatsapp: null,
      company: 'Validation Co',
    },
    proposal: {
      title: `Validation proposal ${suffix}`,
      body: 'Prototype validation payload',
      amount: 1200,
      currency: 'USD',
    },
    maxwell: {
      summary: 'Inbound Maxwell validation summary',
      session_url: 'https://noon.example/session',
      prototype_url: `https://v0.dev/demo/validation-${suffix}`,
      prototype_versions: [],
    },
    metadata: { score: 88 },
  }

  const created = await receiveWebsiteInboundProposal(payload)

  const { data: workspace } = await admin
    .from('prototype_workspaces')
    .select('id, status, generated_content, lead_id')
    .eq('lead_id', created.leadId)
    .maybeSingle()

  const { data: link } = await (admin as ReturnType<typeof createClient<Database>>)
    .from('website_inbound_links' as never)
    .select('id, inbound_payload')
    .eq('id', created.linkId)
    .maybeSingle()

  const inboundPayload = (link as { inbound_payload?: { maxwell?: { prototype_url?: string } } } | null)
    ?.inbound_payload ?? null
  const ok = Boolean(
    workspace
    && workspace.status === 'ready'
    && workspace.generated_content === payload.maxwell.prototype_url
    && inboundPayload?.maxwell?.prototype_url === payload.maxwell.prototype_url
  )

  await (admin as ReturnType<typeof createClient<Database>>)
    .from('website_inbound_links' as never)
    .delete()
    .eq('id', created.linkId)
  if (workspace?.id) {
    await admin.from('prototype_workspaces').delete().eq('id', workspace.id)
  }
  await admin.from('lead_proposals').delete().eq('id', created.proposalId)
  await admin.from('leads').delete().eq('id', created.leadId)

  record(
    'website-inbound-prototype-workspace',
    ok,
    ok
      ? `Workspace ${workspace?.id} creado desde prototype_url del sitio web.`
      : 'El inbound web no persistio prototype_workspaces con la URL del prototipo.'
  )
}

async function main() {
  const env = getPhase1AAdminEnv()
  const admin = createClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  record(
    'website-webhook-secret',
    Boolean(process.env.NOON_WEBSITE_WEBHOOK_SECRET?.trim()),
    process.env.NOON_WEBSITE_WEBHOOK_SECRET?.trim()
      ? 'NOON_WEBSITE_WEBHOOK_SECRET configurado.'
      : 'NOON_WEBSITE_WEBHOOK_SECRET vacio: los webhooks firmados Web->App fallaran hasta configurarlo en App y Website.'
  )

  record(
    'v0-api-key',
    Boolean(process.env.V0_API_KEY?.trim()),
    process.env.V0_API_KEY?.trim()
      ? 'V0_API_KEY presente.'
      : 'V0_API_KEY ausente; generacion v0 deshabilitada.'
  )

  try {
    await validateHandoffReadyMigration(admin)
  } catch (error) {
    record(
      'handoff-ready-migration',
      false,
      error instanceof Error ? error.message : 'Fallo inesperado validando handoff.'
    )
  }

  try {
    await validateWebsiteInboundPrototype(admin)
  } catch (error) {
    record(
      'website-inbound-prototype-workspace',
      false,
      error instanceof Error ? error.message : 'Fallo inesperado validando inbound web.'
    )
  }

  const failed = results.filter((result) => !result.ok)
  if (failed.length > 0) {
    process.exitCode = 1
  }
}

void main()
