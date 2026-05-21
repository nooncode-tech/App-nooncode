import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { revokeClientToken, ClientTokenRevokeError } from '@/lib/server/client-portal/repository'

const routeParamsSchema = z.object({
  tokenId: z.string().uuid(),
})

export async function POST(
  _request: Request,
  context: { params: Promise<{ tokenId: string }> }
) {
  try {
    await requireRole(['admin', 'pm'])
    const { tokenId } = routeParamsSchema.parse(await context.params)
    const client = await createSupabaseServerClient()
    const result = await revokeClientToken(client, tokenId)

    return NextResponse.json({ data: result })
  } catch (error) {
    if (error instanceof ClientTokenRevokeError) {
      const status = error.code === 'TOKEN_NOT_FOUND_OR_ALREADY_REVOKED' ? 404 : 400
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status }
      )
    }
    return toErrorResponse(error)
  }
}
