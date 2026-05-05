import { z } from 'zod'
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { getCurrentPrincipal } from '@/lib/server/auth/session'
import { toErrorResponse } from '@/lib/server/api/errors'
import { decodeCursor } from '@/lib/server/pagination/cursor'
import { buildCursorResponse } from '@/lib/server/pagination/envelope'
import { listEarningsHistory, listAllEarningsHistory } from '@/lib/server/earnings/repository'

const earningsHistorySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

export async function GET(request: Request) {
  try {
    const principal = await getCurrentPrincipal()

    if (!principal) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const parsed = earningsHistorySchema.parse({
      cursor: searchParams.get('cursor') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
    })

    const cursorPayload = parsed.cursor ? decodeCursor(parsed.cursor) : null
    const isAdmin = principal.role === 'admin' || principal.role === 'pm'
    const client = await createSupabaseServerClient()

    const rows = isAdmin
      ? await listAllEarningsHistory(client, { cursor: cursorPayload, limit: parsed.limit })
      : await listEarningsHistory(client, principal.userId, { cursor: cursorPayload, limit: parsed.limit })

    return NextResponse.json(
      buildCursorResponse(rows, {
        limit: parsed.limit,
        getCursor: (item) => ({ createdAt: (item as { created_at: string }).created_at, id: (item as { id: string }).id }),
      })
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
