import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createClientToken, listClientTokensForProject } from '@/lib/server/client-portal/repository'

const updateSchema = z.object({
  tokenId: z.string().uuid(),
  latestUpdateText: z.string().min(1).max(500),
  latestUpdateDate: z.string().datetime().optional(),
  latestUpdateNextStep: z.string().max(300).optional(),
})

const createSchema = z.object({
  projectId: z.string().uuid(),
  leadId: z.string().uuid().nullable().optional(),
  clientName: z.string().min(1).max(160).nullable().optional(),
  clientEmail: z.string().email().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
})

export async function POST(request: Request) {
  try {
    const principal = await requireRole(['admin', 'sales_manager', 'pm', 'sales'])
    const body = createSchema.parse(await request.json())
    const client = await createSupabaseServerClient()

    const token = await createClientToken(
      client,
      body.projectId,
      body.leadId ?? null,
      body.clientName ?? null,
      body.clientEmail ?? null,
      principal.userId,
      body.expiresAt ?? null,
    )

    return NextResponse.json({ data: token }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    await requireRole(['admin', 'pm'])
    const body = updateSchema.parse(await request.json())
    const client = await createSupabaseServerClient()

    const { error } = await client
      .from('client_access_tokens')
      .update({
        latest_update_text: body.latestUpdateText,
        latest_update_date: body.latestUpdateDate ?? new Date().toISOString(),
        latest_update_next_step: body.latestUpdateNextStep ?? null,
      } as never)
      .eq('id', body.tokenId)

    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function GET(request: Request) {
  try {
    await requireRole(['admin', 'sales_manager', 'pm', 'sales'])
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
    }

    const client = await createSupabaseServerClient()
    const tokens = await listClientTokensForProject(client, projectId)

    return NextResponse.json({ data: tokens })
  } catch (err) {
    return toErrorResponse(err)
  }
}
