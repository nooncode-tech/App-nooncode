'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  Gift,
  Star,
  Trophy,
  Zap,
  Clock,
  TrendingUp,
  ShoppingBag,
  Sparkles,
  CircleOff,
  History,
  Loader2,
} from 'lucide-react'

interface StoreItem {
  id: string
  name: string
  description: string | null
  category: string
  points_cost: number
  stock: number | null
}

interface LedgerEntry {
  id: string
  event_type: string
  points: number
  notes: string | null
  created_at: string
}

const eventTypeConfig: Record<string, { label: string; icon: typeof Star }> = {
  lead_won:          { label: 'Lead ganado',         icon: Trophy },
  payment_received:  { label: 'Pago confirmado',     icon: Zap },
  project_milestone: { label: 'Hito de proyecto',    icon: Sparkles },
  manual_grant:      { label: 'Asignación manual',   icon: Gift },
  redemption:        { label: 'Canje',               icon: ShoppingBag },
}

const categoryConfig: Record<string, { color: string; label: string }> = {
  beneficio:       { color: 'bg-green-500/10 text-green-600',  label: 'Beneficio' },
  voucher:         { color: 'bg-blue-500/10 text-blue-600',    label: 'Voucher' },
  experiencia:     { color: 'bg-purple-500/10 text-purple-600',label: 'Experiencia' },
  creditos:        { color: 'bg-yellow-500/10 text-yellow-600',label: 'Créditos' },
  reconocimiento:  { color: 'bg-pink-500/10 text-pink-600',    label: 'Reconocimiento' },
  desarrollo:      { color: 'bg-orange-500/10 text-orange-600',label: 'Desarrollo' },
  general:         { color: 'bg-muted text-muted-foreground',  label: 'General' },
}

export default function RewardsPage() {
  const { authMode, user } = useAuth()
  const isSupabase = authMode === 'supabase'

  const [balance, setBalance] = useState(0)
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [storeItems, setStoreItems] = useState<StoreItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedItem, setSelectedItem] = useState<StoreItem | null>(null)
  const [redeeming, setRedeeming] = useState(false)
  const [activeTab, setActiveTab] = useState('store')

  const loadData = () => {
    if (!isSupabase) return
    setLoading(true)
    fetch('/api/rewards')
      .then((r) => r.json())
      .then((json) => {
        if (json.data) {
          setBalance(json.data.balance)
          setLedger(json.data.ledger)
          setStoreItems(json.data.storeItems)
        }
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadData() }, [isSupabase]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRedeem = async () => {
    if (!selectedItem) return
    setRedeeming(true)
    try {
      const res = await fetch('/api/rewards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: selectedItem.id }),
      })
      const json = await res.json()
      if (res.ok) {
        toast.success(`Canjeado: ${selectedItem.name}`)
        setSelectedItem(null)
        loadData()
      } else {
        toast.error(json.error ?? 'Error al canjear')
      }
    } catch {
      toast.error('Error de red')
    } finally {
      setRedeeming(false)
    }
  }

  if (!user) return null

  // Tier progress (every 500 pts = next tier)
  const tierThreshold = 500
  const tierProgress = Math.min((balance % tierThreshold) / tierThreshold * 100, 100)
  const pointsToNext = tierThreshold - (balance % tierThreshold)
  const currentTier = balance < 500 ? 'Bronce' : balance < 1000 ? 'Plata' : 'Oro'
  const nextTier    = balance < 500 ? 'Plata'  : balance < 1000 ? 'Oro'   : 'Platino'

  if (!isSupabase) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="min-h-[280px]">
            <Empty className="h-full border-0 p-0">
              <EmptyHeader className="my-auto">
                <EmptyMedia variant="icon"><CircleOff className="size-5" /></EmptyMedia>
                <EmptyTitle>Recompensas no disponibles en modo demo</EmptyTitle>
                <EmptyDescription>Inicia sesión con Supabase para ver tus puntos reales.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Recompensas</h1>
        <p className="text-muted-foreground">Gana puntos y canjéalos por premios</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-primary-foreground/80 flex items-center gap-2">
                  <Star className="size-4" /> Tus Puntos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-bold">{balance.toLocaleString()}</div>
                <p className="text-sm text-primary-foreground/70 mt-2">Disponibles para canjear</p>
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">Progreso al siguiente nivel</CardTitle>
                  <Badge variant="secondary" className="bg-accent/10 text-accent">
                    <Trophy className="size-3 mr-1" /> {currentTier}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between mb-2">
                  <span className="text-sm text-muted-foreground">{currentTier}</span>
                  <span className="text-lg font-bold">{balance % tierThreshold} / {tierThreshold}</span>
                  <span className="text-sm text-muted-foreground">{nextTier}</span>
                </div>
                <Progress value={tierProgress} className="h-3" />
                <p className="text-xs text-muted-foreground mt-2">
                  {tierProgress >= 100
                    ? `¡Alcanzaste el nivel ${nextTier}!`
                    : `Faltan ${pointsToNext} puntos para nivel ${nextTier}`}
                </p>
              </CardContent>
            </Card>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="store">
                <ShoppingBag className="size-4 mr-2" /> Tienda
              </TabsTrigger>
              <TabsTrigger value="history">
                <Clock className="size-4 mr-2" /> Historial
              </TabsTrigger>
            </TabsList>

            <TabsContent value="store" className="mt-6">
              {storeItems.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground text-sm">
                    No hay artículos disponibles en la tienda.
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {storeItems.map((item) => {
                    const catConfig = categoryConfig[item.category] ?? categoryConfig.general
                    const canAfford = balance >= item.points_cost
                    const outOfStock = item.stock !== null && item.stock <= 0
                    return (
                      <Card
                        key={item.id}
                        className={cn(
                          'cursor-pointer transition-all hover:shadow-lg',
                          (!canAfford || outOfStock) && 'opacity-60'
                        )}
                        onClick={() => !outOfStock && setSelectedItem(item)}
                      >
                        <CardContent className="p-6">
                          <div className="flex items-start justify-between mb-4">
                            <div className={cn('size-12 rounded-xl flex items-center justify-center', catConfig.color)}>
                              <Gift className="size-6" />
                            </div>
                            <Badge variant="outline" className={catConfig.color}>{catConfig.label}</Badge>
                          </div>
                          <h3 className="font-semibold mb-1">{item.name}</h3>
                          <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{item.description}</p>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1 text-primary font-bold">
                              <Star className="size-4 fill-primary" />
                              {item.points_cost.toLocaleString()} pts
                            </div>
                            <Button size="sm" variant={canAfford && !outOfStock ? 'default' : 'secondary'} disabled={!canAfford || outOfStock}>
                              {outOfStock ? 'Agotado' : canAfford ? 'Canjear' : 'Sin puntos'}
                            </Button>
                          </div>
                          {item.stock !== null && (
                            <p className="text-xs text-muted-foreground mt-2">{item.stock} disponibles</p>
                          )}
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Historial de Puntos</CardTitle>
                </CardHeader>
                <CardContent>
                  {ledger.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8 text-sm">
                      Aún no tienes actividad de puntos registrada.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {ledger.map((entry) => {
                        const cfg = eventTypeConfig[entry.event_type] ?? { label: entry.event_type, icon: TrendingUp }
                        const Icon = cfg.icon
                        return (
                          <div key={entry.id} className="flex items-center justify-between p-3 border rounded-lg">
                            <div className="flex items-center gap-3">
                              <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center">
                                <Icon className="size-5 text-primary" />
                              </div>
                              <div>
                                <p className="font-medium text-sm">{entry.notes ?? cfg.label}</p>
                                <p className="text-xs text-muted-foreground">
                                  {cfg.label} · {new Date(entry.created_at).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })}
                                </p>
                              </div>
                            </div>
                            <span className={cn('text-lg font-bold', entry.points > 0 ? 'text-primary' : 'text-destructive')}>
                              {entry.points > 0 ? '+' : ''}{entry.points}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* Redeem dialog */}
      <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Canjear recompensa</DialogTitle>
            <DialogDescription>Confirma que deseas canjear este artículo</DialogDescription>
          </DialogHeader>
          {selectedItem && (
            <div className="space-y-4">
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="font-semibold">{selectedItem.name}</p>
                <p className="text-sm text-muted-foreground mt-1">{selectedItem.description}</p>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Costo</span>
                  <span className="font-bold flex items-center gap-1">
                    <Star className="size-3 fill-primary text-primary" />
                    {selectedItem.points_cost.toLocaleString()} pts
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tus puntos</span>
                  <span className="font-bold">{balance.toLocaleString()} pts</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="font-medium">Puntos restantes</span>
                  <span className={cn('font-bold', balance - selectedItem.points_cost >= 0 ? 'text-green-600' : 'text-destructive')}>
                    {(balance - selectedItem.points_cost).toLocaleString()} pts
                  </span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedItem(null)}>Cancelar</Button>
            <Button onClick={handleRedeem} disabled={redeeming || !selectedItem || balance < (selectedItem?.points_cost ?? 0)}>
              {redeeming ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Gift className="size-4 mr-2" />}
              Confirmar Canje
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
