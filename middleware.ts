import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { getPhase1APublicEnv, hasSupabasePublicEnv, isSupabaseAuthEnabled } from '@/lib/env'
import {
  canAccessDashboardPath,
  getAuthorizedDashboardPath,
  isProtectedDashboardPath,
} from '@/lib/server/auth/policy'
import type { Database } from '@/lib/server/supabase/database.types'

function redirectWithCookies(
  request: NextRequest,
  response: NextResponse,
  pathname: string
) {
  const redirectResponse = NextResponse.redirect(new URL(pathname, request.url))

  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie)
  })

  return redirectResponse
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request,
  })

  if (!isProtectedDashboardPath(request.nextUrl.pathname)) {
    return response
  }

  if (!isSupabaseAuthEnabled() || !hasSupabasePublicEnv()) {
    return response
  }

  const env = getPhase1APublicEnv()
  const supabase = createServerClient<Database>(
    env.supabaseUrl,
    env.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }: { name: string; value: string; options: CookieOptions }) => {
            request.cookies.set(name, value)
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return redirectWithCookies(request, response, '/')
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('id, role, is_active')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError || !profile || !profile.is_active) {
    return redirectWithCookies(request, response, '/')
  }

  if (!canAccessDashboardPath(profile.role, request.nextUrl.pathname)) {
    return redirectWithCookies(
      request,
      response,
      getAuthorizedDashboardPath(profile.role, request.nextUrl.pathname)
    )
  }

  return response
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
