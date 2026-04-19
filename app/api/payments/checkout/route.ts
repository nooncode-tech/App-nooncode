import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { createCheckoutSession } from '@/lib/server/stripe/service'

const bodySchema = z.object({
  proposalId: z.string().uuid(),
  leadId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  clientName: z.string().min(1),
  clientEmail: z.string().email().nullable(),
})

export async function POST(request: Request) {
  try {
    const principal = await requireRole(['admin', 'sales_manager', 'sales'])
    const body = bodySchema.parse(await request.json())
    const client = await createSupabaseServerClient()

    // Load the proposal to get amount, currency, title
    const { data: proposal, error: proposalError } = await client
      .from('lead_proposals')
      .select('id, title, amount, currency, status, lead_id')
      .eq('id', body.proposalId)
      .maybeSingle()

    if (proposalError || !proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    if (proposal.lead_id !== body.leadId) {
      return NextResponse.json({ error: 'Proposal does not belong to this lead' }, { status: 400 })
    }

    if (!['sent', 'accepted', 'handoff_ready'].includes(proposal.status)) {
      return NextResponse.json(
        { error: 'Proposal must be sent or accepted before payment' },
        { status: 400 }
      )
    }

    if (proposal.amount <= 0) {
      return NextResponse.json({ error: 'Proposal amount must be greater than zero' }, { status: 400 })
    }

    // Check for existing succeeded payment
    const { data: existingPayment } = await client
      .from('payments')
      .select('id, status')
      .eq('proposal_id', body.proposalId)
      .eq('status', 'succeeded')
      .maybeSingle()

    if (existingPayment) {
      return NextResponse.json({ error: 'This proposal has already been paid' }, { status: 409 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.headers.get('origin') ?? 'http://localhost:3000'

    const { url, paymentId } = await createCheckoutSession(
      client,
      principal,
      {
        proposalId: proposal.id,
        leadId: body.leadId,
        projectId: body.projectId,
        amount: Number(proposal.amount),
        currency: proposal.currency,
        clientName: body.clientName,
        clientEmail: body.clientEmail,
        proposalTitle: proposal.title,
      },
      appUrl,
    )

    return NextResponse.json({ data: { url, paymentId } })
  } catch (error) {
    return toErrorResponse(error)
  }
}
