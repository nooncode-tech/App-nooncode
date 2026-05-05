import Link from 'next/link'
import { Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default function PaymentCancelPage() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="py-10 text-center space-y-4">
          <Clock className="size-10 text-muted-foreground mx-auto" />
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Pago no completado</h1>
            <p className="text-sm text-muted-foreground">
              El proyecto no inicia hasta que el pago quede confirmado.
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
