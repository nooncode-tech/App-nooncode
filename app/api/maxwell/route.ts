import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import {
  consumeStream,
  convertToModelMessages,
  dynamicTool,
  stepCountIs,
  streamText,
  type UIMessage,
} from 'ai'
import { buildMaxwellSystemPrompt } from '@/lib/maxwell/system-prompt'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import { requireRole } from '@/lib/server/auth/guards'
import { getLeadById } from '@/lib/server/leads/repository'
import { assertSalesLeadOwnership } from '@/lib/server/leads/permissions'
import { toErrorResponse } from '@/lib/server/api/errors'

export const maxDuration = 60

export async function POST(req: Request) {
  try {
  const {
    messages,
    leadId,
    leadName,
    channel,
  }: {
    messages: UIMessage[]
    leadId?: string
    leadName?: string
    channel?: string
  } = await req.json()

  const serverClient = await createSupabaseServerClient()
  const principal = await requireRole(['admin', 'sales_manager', 'sales', 'pm'])

  if (leadId) {
    const lead = await getLeadById(serverClient, leadId)
    if (!lead) {
      return new Response(JSON.stringify({ error: 'Lead not found' }), { status: 404 })
    }
    assertSalesLeadOwnership(principal, lead)
  }

  const systemPrompt = buildMaxwellSystemPrompt({ leadId, leadName, channel })

  const tools = leadId
    ? {
        create_proposal: dynamicTool({
          description: 'Crea y guarda una propuesta comercial en el sistema para el lead actual',
          inputSchema: z.object({
            title: z.string().trim().min(1).max(160).describe('Titulo descriptivo de la propuesta'),
            body: z.string().trim().min(1).max(12000).describe('Texto completo de la propuesta en markdown'),
            amount: z.number().positive().describe('Precio de activacion en USD'),
            currency: z.string().trim().min(3).max(8).optional(),
          }),
          execute: async (input) => {
            const {
              title,
              body,
              amount,
              currency: cur,
            } = input as { title: string; body: string; amount: number; currency?: string }
            const currency = (cur ?? 'USD').toUpperCase()

            try {
              const adminClient = await createSupabaseAdminClient()

              const { data: proposal, error } = await adminClient
                .from('lead_proposals')
                .insert({
                  lead_id: leadId,
                  created_by: principal.userId,
                  title,
                  body,
                  amount,
                  currency,
                  status: 'draft',
                  sent_at: null,
                  accepted_at: null,
                  handoff_ready_at: null,
                } as never)
                .select('id')
                .single() as { data: { id: string } | null; error: unknown }

              if (error || !proposal) {
                return { success: false, error: 'No se pudo guardar la propuesta' }
              }

              const { data: admins } = await adminClient
                .from('user_profiles' as never)
                .select('id')
                .in('role', ['admin', 'pm'])
                .eq('is_active', true) as { data: { id: string }[] | null }

              if (admins && admins.length > 0) {
                await adminClient.from('user_notifications').insert(
                  admins.map((a: { id: string }) => ({
                    profile_id: a.id,
                    title: 'Nueva propuesta generada por Maxwell',
                    body: `"${title}" - pendiente de revision`,
                    source_kind: 'proposal_review',
                    source_id: proposal.id,
                  })) as never
                )
              }

              return { success: true, proposalId: proposal.id }
            } catch (err) {
              return { success: false, error: String(err) }
            }
          },
        }),
      }
    : undefined

  const result = streamText({
    model: openai('gpt-4o-mini'),
    system: systemPrompt,
    messages: await convertToModelMessages(messages),
    abortSignal: req.signal,
    tools,
    stopWhen: stepCountIs(leadId ? 5 : 1),
  })

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    consumeSseStream: consumeStream,
  })
  } catch (error) {
    return toErrorResponse(error)
  }
}
