import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { getOrCreateConnectAccount, createOnboardingLink } from '@/lib/server/stripe/connect'

function handleConnectError(err: unknown, context: 'POST' | 'GET') {
  if (err instanceof Stripe.errors.StripeError) {
    console.error('[connect-onboard]', context, {
      type: err.type,
      code: err.code,
      statusCode: err.statusCode,
      message: err.message,
      requestId: err.requestId,
    })
    return NextResponse.json(
      {
        error: `Stripe: ${err.message}`,
        code: err.code ?? err.type ?? 'STRIPE_ERROR',
      },
      { status: err.statusCode ?? 502 }
    )
  }
  console.error('[connect-onboard]', context, 'non-Stripe error', err)
  return toErrorResponse(err)
}

export async function POST(request: Request) {
  try {
    const principal = await requireRole(['admin', 'pm', 'developer', 'sales_manager', 'sales'])

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.headers.get('origin') ?? 'http://localhost:3000'
    const returnUrl = `${appUrl}/dashboard/earnings?connect=success`
    const refreshUrl = `${appUrl}/api/connect/onboard`

    const client = await createSupabaseServerClient()
    const accountId = await getOrCreateConnectAccount(
      client,
      principal.profile.id,
      principal.profile.email,
    )

    const url = await createOnboardingLink(accountId, returnUrl, refreshUrl)

    return NextResponse.json({ data: { url } })
  } catch (err) {
    return handleConnectError(err, 'POST')
  }
}

// Stripe redirects to refresh_url as GET when the onboarding link expires — regenerate it
export async function GET(request: Request) {
  try {
    const principal = await requireRole(['admin', 'pm', 'developer', 'sales_manager', 'sales'])

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.headers.get('origin') ?? 'http://localhost:3000'
    const returnUrl = `${appUrl}/dashboard/earnings?connect=success`
    const refreshUrl = `${appUrl}/api/connect/onboard`

    const client = await createSupabaseServerClient()
    const accountId = await getOrCreateConnectAccount(
      client,
      principal.profile.id,
      principal.profile.email,
    )

    const url = await createOnboardingLink(accountId, returnUrl, refreshUrl)

    return NextResponse.redirect(url)
  } catch (err) {
    return handleConnectError(err, 'GET')
  }
}
