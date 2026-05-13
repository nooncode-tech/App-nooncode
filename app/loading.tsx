import { Loader2 } from 'lucide-react'

export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Cargando"
      className="min-h-screen flex items-center justify-center bg-background"
    >
      <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
    </div>
  )
}
