import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/server/api/errors'
import {
  receiveWebsiteInboundProposal,
  websiteInboundProposalPayloadSchema,
} from '@/lib/server/website-integration'
import { readSignedWebsiteJson, WebsiteWebhookError } from '@/lib/server/website-webhook-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const payload = await readSignedWebsiteJson(request, websiteInboundProposalPayloadSchema)
    const result = await receiveWebsiteInboundProposal(payload)

    return NextResponse.json({ data: result }, { status: result.idempotent ? 200 : 201 })
  } catch (error) {
    if (error instanceof WebsiteWebhookError) {
      return NextResponse.json(
        { error: error.message, code: 'WEBSITE_WEBHOOK_AUTH_FAILED' },
        { status: error.status }
      )
    }

    return toErrorResponse(error)
  }
}
