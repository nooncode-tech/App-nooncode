import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { getCurrentPrincipal } from '@/lib/server/auth/session'

export default async function NotFound() {
  let isAuthenticated = false

  try {
    const principal = await getCurrentPrincipal()
    isAuthenticated = principal !== null
  } catch {
    isAuthenticated = false
  }

  const targetHref = isAuthenticated ? '/dashboard' : '/'
  const targetLabel = isAuthenticated ? 'Volver al dashboard' : 'Volver al inicio'

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md text-center space-y-6">
        <p className="text-sm font-medium text-primary uppercase tracking-wider">
          Error 404
        </p>
        <h1 className="text-4xl font-semibold text-foreground">
          Página no encontrada
        </h1>
        <p className="text-muted-foreground">
          La ruta que buscás no existe o fue movida. Verificá el enlace o volvé al inicio.
        </p>
        <Button asChild size="lg">
          <Link href={targetHref}>{targetLabel}</Link>
        </Button>
      </div>
    </div>
  )
}
