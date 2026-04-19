import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentPrincipal } from '@/lib/server/auth/session'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { toErrorResponse } from '@/lib/server/api/errors'

// Critical notifications — always on, cannot be disabled
const CRITICAL_KEYS = ['lead_assigned', 'task_assigned', 'payment_received'] as const

const preferencesSchema = z.object({
  lead_assigned: z.boolean().optional(),
  lead_status_changed: z.boolean().optional(),
  proposal_sent: z.boolean().optional(),
  payment_received: z.boolean().optional(),
  task_assigned: z.boolean().optional(),
  task_status_changed: z.boolean().optional(),
  project_status_changed: z.boolean().optional(),
  project_field_changed: z.boolean().optional(),
})

export async function GET() {
  try {
    const principal = await getCurrentPrincipal()
    if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const client = await createSupabaseServerClient()
    const { data, error } = await client
      .from('user_profiles')
      .select('notification_preferences')
      .eq('id', principal.userId)
      .single()

    if (error) throw new Error(error.message)

    return NextResponse.json({ data: data.notification_preferences })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const principal = await getCurrentPrincipal()
    if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = preferencesSchema.parse(await request.json())

    // Enforce critical notifications cannot be disabled
    const sanitized = { ...body }
    for (const key of CRITICAL_KEYS) {
      if (key in sanitized) {
        sanitized[key] = true
      }
    }

    const client = await createSupabaseServerClient()

    // Merge with existing preferences
    const { data: existing } = await client
      .from('user_profiles')
      .select('notification_preferences')
      .eq('id', principal.userId)
      .single()

    const merged = { ...(existing?.notification_preferences ?? {}), ...sanitized }

    const { error } = await client
      .from('user_profiles')
      .update({ notification_preferences: merged })
      .eq('id', principal.userId)

    if (error) throw new Error(error.message)

    return NextResponse.json({ data: merged })
  } catch (err) {
    return toErrorResponse(err)
  }
}
