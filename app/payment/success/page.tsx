import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default function PaymentSuccessPage() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="py-10 text-center space-y-4">
          <CheckCircle2 className="size-10 text-emerald-600 mx-auto" />
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Pago recibido</h1>
            <p className="text-sm text-muted-foreground">
              Noon confirmara el proyecto y activara el workspace cuando Stripe termine la verificacion.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/">Volver a Noon</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
