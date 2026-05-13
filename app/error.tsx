'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth-context'

interface ErrorPageProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  // useAuth() throws only when AuthProvider is not mounted — which can only
  // happen if the root layout itself failed. In that scenario Next.js renders
  // global-error.tsx instead of this boundary, so reaching this code path
  // guarantees the provider is alive.
  const { user } = useAuth()
  const isAuthenticated = user !== null

  useEffect(() => {
    // Browser console only — there is no Sentry / telemetry wiring per the
    // observability deferral. Vercel native log streams capture the server
    // side; this console.error gives the operator-in-the-loop visibility
    // when they inspect DevTools.
    console.error('App-level error boundary captured:', error)
  }, [error])

  const targetHref = isAuthenticated ? '/dashboard' : '/'
  const targetLabel = isAuthenticated ? 'Volver al dashboard' : 'Volver al inicio'

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md text-center space-y-6">
        <p className="text-sm font-medium text-destructive uppercase tracking-wider">
          Algo no funcionó
        </p>
        <h1 className="text-4xl font-semibold text-foreground">
          Hubo un problema inesperado
        </h1>
        <p className="text-muted-foreground">
          Ocurrió un error al cargar esta vista. Podés reintentar o volver al inicio.
        </p>
        {error.digest ? (
          <p className="font-mono text-xs text-muted-foreground/60">
            Ref: {error.digest}
          </p>
        ) : null}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button size="lg" onClick={() => reset()}>
            Reintentar
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={targetHref}>{targetLabel}</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
