import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { rotateClientToken, ClientTokenRotateError } from '@/lib/server/client-portal/repository'

const routeParamsSchema = z.object({
  tokenId: z.string().uuid(),
})

const bodySchema = z
  .object({
    newExpiresAt: z.string().datetime().nullable().optional(),
  })
  .strict()
  .default({})

export async function POST(
  request: Request,
  context: { params: Promise<{ tokenId: string }> }
) {
  try {
    await requireRole(['admin', 'pm'])
    const { tokenId } = routeParamsSchema.parse(await context.params)

    const rawBody = await request.json().catch(() => ({}))
    const { newExpiresAt = null } = bodySchema.parse(rawBody)

    const client = await createSupabaseServerClient()
    const result = await rotateClientToken(client, tokenId, newExpiresAt)

    return NextResponse.json({ data: result })
  } catch (error) {
    if (error instanceof ClientTokenRotateError) {
      const status =
        error.code === 'TOKEN_NOT_FOUND' || error.code === 'TOKEN_ALREADY_REVOKED'
          ? 404
          : 400
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status }
      )
    }
    return toErrorResponse(error)
  }
}
