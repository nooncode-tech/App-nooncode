import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { getConnectAccountDetails } from '@/lib/server/stripe/connect'

export async function GET() {
  try {
    const principal = await requireRole(['admin', 'pm', 'developer', 'sales_manager', 'sales'])

    const client = await createSupabaseServerClient()
    const { data: profile } = await client
      .from('user_profiles' as never)
      .select('stripe_connect_account_id, stripe_connect_status')
      .eq('id', principal.profile.id)
      .maybeSingle() as { data: { stripe_connect_account_id: string | null; stripe_connect_status: string } | null }

    if (!profile?.stripe_connect_account_id) {
      return NextResponse.json({ data: { status: 'none', accountId: null } })
    }

    const details = await getConnectAccountDetails(profile.stripe_connect_account_id)

    // Sync status to DB if it changed
    if (details.status !== profile.stripe_connect_status) {
      await client
        .from('user_profiles' as never)
        .update({ stripe_connect_status: details.status } as never)
        .eq('id', principal.profile.id)
    }

    return NextResponse.json({ data: details })
  } catch (err) {
    return toErrorResponse(err)
  }
}
