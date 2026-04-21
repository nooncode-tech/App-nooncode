import { NextResponse } from 'next/server'
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import { toErrorResponse } from '@/lib/server/api/errors'

const CRON_SECRET = process.env.CRON_SECRET

function isCronAuthorized(request: Request): boolean {
  const auth = request.headers.get('authorization')
  if (!CRON_SECRET) return false
  return auth === `Bearer ${CRON_SECRET}`
}

async function generateFollowUpMessage(lead: {
  name: string
  company: string | null
  notes: string | null
  source: string
  daysSinceContact: number
}): Promise<string> {
  const context = [
    `Lead: ${lead.name}`,
    lead.company ? `Empresa: ${lead.company}` : null,
    `Fuente: ${lead.source}`,
    lead.notes ? `Notas: ${lead.notes.slice(0, 300)}` : null,
    `Días sin contacto: ${lead.daysSinceContact}`,
  ].filter(Boolean).join('\n')

  const { text } = await generateText({
    model: openai('gpt-4o-mini'),
    system: `Eres un asistente comercial de Noon. Redacta mensajes de seguimiento breves, naturales y personalizados para enviar por WhatsApp o email.
El mensaje debe ser de 2-3 oraciones, cordial, no intrusivo, y generar interés sin presionar.
Responde SOLO con el mensaje, sin saludos de apertura como "Hola [nombre]:" — el vendedor lo personalizará.
Responde en español.`,
    prompt: `Genera un mensaje de seguimiento para este lead que no ha respondido:\n${context}`,
  })

  return text.trim()
}

export async function POST(request: Request) {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const client = await createSupabaseAdminClient()
    const now = new Date()
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000)

    // Find overdue leads with auto-followup enabled and no recent AI activity
    const { data: leads, error } = await client
      .from('leads')
      .select('id, name, company, notes, source, assigned_to, last_contacted_at, next_follow_up_at')
      .eq('auto_followup_enabled', true)
      .not('next_follow_up_at', 'is', null)
      .lt('next_follow_up_at', now.toISOString())
      .not('status', 'in', '("won","lost")')
      .limit(10)

    if (error) throw new Error(error.message)
    if (!leads || leads.length === 0) {
      return NextResponse.json({ data: { processed: 0 } })
    }

    // Filter out leads that already got an auto-followup in the last 6h
    const { data: recentActivities } = await client
      .from('lead_activities')
      .select('lead_id')
      .in('lead_id', leads.map((l) => l.id))
      .gte('created_at', sixHoursAgo.toISOString())
      .contains('metadata', { auto_followup: true })

    const recentlyFollowedUp = new Set((recentActivities ?? []).map((a) => a.lead_id))
    const eligibleLeads = leads.filter((l) => !recentlyFollowedUp.has(l.id))

    let processed = 0

    for (const lead of eligibleLeads) {
      const daysSinceContact = lead.last_contacted_at
        ? Math.floor((now.getTime() - new Date(lead.last_contacted_at).getTime()) / 86400000)
        : 0

      try {
        const message = await generateFollowUpMessage({
          name: lead.name,
          company: lead.company,
          notes: lead.notes,
          source: lead.source,
          daysSinceContact,
        })

        // Log as activity
        await client.from('lead_activities').insert({
          lead_id: lead.id,
          activity_type: 'note_added',
          actor_profile_id: null,
          note_body: `Seguimiento automático sugerido:\n\n${message}`,
          metadata: { auto_followup: true, generated_at: now.toISOString() },
        })

        // Notify the assigned vendor
        if (lead.assigned_to) {
          await client.rpc('enqueue_user_notification', {
            target_profile_id: lead.assigned_to,
            next_domain: 'sales',
            next_source_kind: 'lead_activity',
            next_source_event_id: lead.id,
            next_title: `Seguimiento pendiente: ${lead.name}`,
            next_body: 'Maxwell generó un mensaje de seguimiento para este lead.',
            next_href: `/dashboard/leads?leadId=${lead.id}`,
          })
        }

        processed++
      } catch {
        // Skip this lead if AI fails, continue with others
      }
    }

    return NextResponse.json({ data: { processed, eligible: eligibleLeads.length } })
  } catch (err) {
    return toErrorResponse(err)
  }
}
