import { NextResponse } from 'next/server'
import { requirePrincipal } from '@/lib/server/auth/guards'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { toErrorResponse } from '@/lib/server/api/errors'

const salesRoles = ['admin', 'sales_manager', 'sales']
const deliveryRoles = ['admin', 'pm', 'developer']

export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal()
    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q')?.trim() ?? ''

    if (q.length < 2) {
      return NextResponse.json({ data: { leads: [], projects: [], tasks: [] } })
    }

    const client = await createSupabaseServerClient()
    const leads: unknown[] = []
    const projects: unknown[] = []
    const tasks: unknown[] = []

    if (salesRoles.includes(principal.role)) {
      const { data } = await client
        .from('leads')
        .select('id, name, email, company, status')
        .or(`name.ilike.%${q}%,email.ilike.%${q}%,company.ilike.%${q}%`)
        .limit(6)
      if (data) leads.push(...data)
    }

    const { data: projectData } = await client
      .from('projects')
      .select('id, name, status')
      .ilike('name', `%${q}%`)
      .limit(5)
    if (projectData) projects.push(...projectData)

    if (deliveryRoles.includes(principal.role)) {
      const { data: taskData } = await client
        .from('tasks')
        .select('id, title, status, project_id')
        .ilike('title', `%${q}%`)
        .limit(5)
      if (taskData) tasks.push(...taskData)
    }

    return NextResponse.json({ data: { leads, projects, tasks } })
  } catch (err) {
    return toErrorResponse(err)
  }
}
