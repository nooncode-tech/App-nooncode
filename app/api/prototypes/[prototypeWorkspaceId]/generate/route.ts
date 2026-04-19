import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import { generateV0Prototype } from '@/lib/server/v0/client'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ prototypeWorkspaceId: string }> }
) {
  try {
    await requireRole(['admin', 'pm', 'sales_manager', 'sales'])

    const { prototypeWorkspaceId } = await params
    const client = await createSupabaseAdminClient()

    // Load workspace
    const { data: workspace, error: wsError } = await client
      .from('prototype_workspaces')
      .select('id, lead_id, status')
      .eq('id', prototypeWorkspaceId)
      .maybeSingle()

    if (wsError || !workspace) {
      return NextResponse.json({ error: 'Prototype workspace not found' }, { status: 404 })
    }

    if (workspace.status === 'ready' || workspace.status === 'delivery_active') {
      return NextResponse.json({ error: 'Prototype already generated' }, { status: 409 })
    }

    // Load lead for context
    const { data: lead } = await client
      .from('leads')
      .select('name, company, tags, notes, source')
      .eq('id', workspace.lead_id)
      .maybeSingle()

    // Load latest proposal for amount/description
    const { data: proposal } = await client
      .from('lead_proposals')
      .select('amount, content')
      .eq('lead_id', workspace.lead_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Build prompt
    const prompt = [
      'Genera un prototipo de aplicación web para un cliente con las siguientes características:',
      `- Nombre del cliente: ${lead?.name ?? 'No especificado'}`,
      lead?.company ? `- Empresa: ${lead.company}` : null,
      lead?.tags?.length ? `- Industria / Etiquetas: ${(lead.tags as string[]).join(', ')}` : null,
      lead?.notes ? `- Descripción del proyecto: ${lead.notes}` : null,
      proposal?.amount ? `- Presupuesto estimado: $${proposal.amount} USD` : null,
      proposal?.content ? `- Detalles de la propuesta: ${proposal.content}` : null,
      '',
      'El prototipo debe ser un componente React moderno con Tailwind CSS.',
      'Enfócate en la pantalla principal / dashboard del producto.',
      'Usa datos de ejemplo realistas. Incluye navegación lateral, encabezado y contenido principal.',
    ]
      .filter(Boolean)
      .join('\n')

    // Call v0
    const { content, demoUrl, chatUrl } = await generateV0Prototype(prompt)

    // Save result
    const now = new Date().toISOString()
    const { error: updateError } = await client
      .from('prototype_workspaces')
      .update({
        generation_prompt: prompt,
        generated_content: demoUrl ?? chatUrl ?? content,
        generated_at: now,
        status: 'ready',
      })
      .eq('id', prototypeWorkspaceId)

    if (updateError) {
      throw new Error(`Failed to save generated prototype: ${updateError.message}`)
    }

    return NextResponse.json({
      data: {
        workspaceId: prototypeWorkspaceId,
        generatedContent: content,
        demoUrl,
        chatUrl,
        generatedAt: now,
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
