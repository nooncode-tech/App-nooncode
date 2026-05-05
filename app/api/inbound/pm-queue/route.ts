import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/server/api/errors'
import { requireRole } from '@/lib/server/auth/guards'
import { listInboundPmQueue } from '@/lib/server/website-integration'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireRole(['admin', 'pm'])
    const queue = await listInboundPmQueue()

    return NextResponse.json({ data: queue })
  } catch (error) {
    return toErrorResponse(error)
  }
}
