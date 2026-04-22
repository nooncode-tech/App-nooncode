'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { buildLeadDetailHref, clearDashboardEntityHref } from '@/lib/dashboard-navigation'
import { useData } from '@/lib/data-context'
import type { Lead, LeadStatus } from '@/lib/types'
import {
  leadStatusLabels,
  selectLeadList,
  selectLeadsSummary,
  getRadiusKmForWonLeads,
  haversineKm,
  type LeadSortOption,
  type LeadStatusFilter,
} from '@/lib/dashboard-selectors'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { LeadCard } from '@/components/lead-card'
import { LeadDetail } from '@/components/lead-detail'
import { LeadFormDialog } from '@/components/lead-form-dialog'
import { LeadImportDialog } from '@/components/lead-import-dialog'
import { Spinner } from '@/components/ui/spinner'
import {
  Search,
  Filter,
  Plus,
  Users,
  TrendingUp,
  Clock,
  Star,
  MapPin,
} from 'lucide-react'
import { toast } from 'sonner'

export default function LeadsPage() {
  const { user } = useAuth()
  const { leads, isLeadsLoading, updateLeadStatus, deleteLead } = useData()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<LeadStatusFilter>('all')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [sortBy, setSortBy] = useState<LeadSortOption>('score')
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [leadToDelete, setLeadToDelete] = useState<Lead | null>(null)
  const [proximityEnabled, setProximityEnabled] = useState(false)
  const [vendorLocation, setVendorLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [isGeoLoading, setIsGeoLoading] = useState(false)
  const requestedLeadId = searchParams.get('leadId')

  const replaceLeadHref = (leadId: string | null) => {
    const nextHref = leadId
      ? buildLeadDetailHref(leadId, searchParams)
      : clearDashboardEntityHref(pathname, searchParams, 'leadId')

    router.replace(nextHref, { scroll: false })
  }

  useEffect(() => {
    if (!selectedLead) {
      return
    }

    const nextSelectedLead = leads.find((lead) => lead.id === selectedLead.id) ?? null

    if (!nextSelectedLead) {
      setSelectedLead(null)

      if (requestedLeadId === selectedLead.id) {
        replaceLeadHref(null)
      }

      return
    }

    if (nextSelectedLead !== selectedLead) {
      setSelectedLead(nextSelectedLead)
    }
  }, [leads, requestedLeadId, selectedLead])

  useEffect(() => {
    if (!requestedLeadId || isLeadsLoading) {
      return
    }

    if (selectedLead?.id === requestedLeadId) {
      return
    }

    const requestedLead = leads.find((lead) => lead.id === requestedLeadId) ?? null

    if (!requestedLead) {
      replaceLeadHref(null)
      return
    }

    setSelectedLead(requestedLead)
  }, [isLeadsLoading, leads, requestedLeadId, selectedLead])

  const handleProximityToggle = () => {
    if (proximityEnabled) {
      setProximityEnabled(false)
      setVendorLocation(null)
      return
    }
    if (!navigator.geolocation) {
      toast.error('Tu navegador no soporta geolocalización')
      return
    }
    setIsGeoLoading(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        setVendorLocation({ lat, lng })
        setProximityEnabled(true)
        setIsGeoLoading(false)
        toast.info(`Tu ubicación: ${lat.toFixed(4)}, ${lng.toFixed(4)}`)
      },
      () => {
        toast.error('No se pudo obtener tu ubicación')
        setIsGeoLoading(false)
      }
    )
  }

  if (!user) return null

  const wonLeadsCount = leads.filter((l) => l.status === 'won' && l.assignedTo === user.id).length
  const radiusKm = getRadiusKmForWonLeads(wonLeadsCount)

  const filteredLeads = selectLeadList(leads, {
    searchQuery,
    statusFilter,
    sortBy,
    proximityFilter:
      proximityEnabled && vendorLocation
        ? { vendorLat: vendorLocation.lat, vendorLng: vendorLocation.lng, radiusKm }
        : undefined,
  })
  const { totalLeads, highScoreLeads, avgScore, pipelineValue } = selectLeadsSummary(leads)

  const handleStatusChange = async (leadId: string, newStatus: LeadStatus) => {
    try {
      const updatedLead = await updateLeadStatus(leadId, newStatus)
      if (selectedLead?.id === leadId) {
        setSelectedLead(updatedLead)
      }
      return updatedLead
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el lead')
      throw error
    }
  }

  const handleDelete = async () => {
    if (leadToDelete) {
      try {
        await deleteLead(leadToDelete.id)
        toast.success('Lead eliminado correctamente')
        setLeadToDelete(null)
        if (selectedLead?.id === leadToDelete.id) {
          setSelectedLead(null)

          if (requestedLeadId === leadToDelete.id) {
            replaceLeadHref(null)
          }
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'No se pudo eliminar el lead')
      }
    }
  }

  const handleOpenLead = (lead: Lead) => {
    setSelectedLead(lead)

    if (requestedLeadId !== lead.id) {
      replaceLeadHref(lead.id)
    }
  }

  const handleLeadDialogChange = (open: boolean) => {
    if (open) {
      return
    }

    setSelectedLead(null)

    if (requestedLeadId) {
      replaceLeadHref(null)
    }
  }

  return (
    <div>
      <div className="relative bg-[#000000] px-8 pt-4 pb-4 border-b border-white/[0.05] flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white leading-none">Leads</h1>
          <p className="mt-1 text-xs text-white/40">Gestiona tu cola de prospectos y prioriza por score</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <LeadImportDialog onImported={() => {}} />
          <Button onClick={() => setShowNewDialog(true)}>
            <Plus className="size-4 mr-2" />
            Nuevo Lead
          </Button>
        </div>
      </div>
      <div className="px-6 py-4 space-y-4">

      {/* Stats row */}
      <div className="grid grid-cols-4 divide-x rounded-xl border overflow-hidden bg-card">
        <div className="px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Leads</p>
          <p className="text-xl font-bold tabular-nums mt-0.5">{totalLeads}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">High Score</p>
          <p className="text-xl font-bold tabular-nums mt-0.5">{highScoreLeads}</p>
          <p className="text-[10px] text-muted-foreground">80+</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Score prom.</p>
          <p className="text-xl font-bold tabular-nums mt-0.5">{avgScore}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Pipeline</p>
          <p className="text-xl font-bold tabular-nums mt-0.5">${pipelineValue.toLocaleString()}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, empresa o email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as LeadStatusFilter)}
        >
          <SelectTrigger className="w-full sm:w-[150px]">
            <Filter className="size-4 mr-2" />
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(leadStatusLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(value) => setSortBy(value as LeadSortOption)}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder="Ordenar por" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="score">Mayor Score</SelectItem>
            <SelectItem value="value">Mayor Valor</SelectItem>
            <SelectItem value="date">Mas Reciente</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={proximityEnabled ? 'default' : 'outline'}
          onClick={handleProximityToggle}
          disabled={isGeoLoading}
          className="w-full sm:w-auto"
          title={proximityEnabled && radiusKm ? `Radio: ${radiusKm} km` : 'Filtrar por proximidad'}
        >
          <MapPin className="size-4 mr-2" />
          {isGeoLoading ? 'Ubicando...' : proximityEnabled ? `${radiusKm ?? '∞'} km` : 'Cercanos'}
        </Button>
      </div>

      {/* Lead List */}
      <div className="space-y-2">
        {isLeadsLoading ? (
          <Card className="p-12 text-center">
            <div className="flex flex-col items-center gap-3">
              <Spinner className="size-8" />
              <p className="text-muted-foreground">Cargando leads...</p>
            </div>
          </Card>
        ) : filteredLeads.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="flex flex-col items-center gap-3">
              <Users className="size-12 text-muted-foreground/50" />
              <p className="text-muted-foreground">No se encontraron leads</p>
              <Button variant="outline" onClick={() => setShowNewDialog(true)}>
                <Plus className="size-4 mr-2" />
                Agregar primer lead
              </Button>
            </div>
          </Card>
        ) : (
          filteredLeads.map((lead) => {
            const distanceKm =
              proximityEnabled && vendorLocation && lead.latitude != null && lead.longitude != null
                ? haversineKm(vendorLocation.lat, vendorLocation.lng, lead.latitude, lead.longitude)
                : undefined
            return (
              <LeadCard
                key={lead.id}
                lead={lead}
                onClick={() => handleOpenLead(lead)}
                onStatusChange={handleStatusChange}
                onDelete={() => setLeadToDelete(lead)}
                distanceKm={distanceKm}
              />
            )
          })
        )}
      </div>

      {/* Lead Detail Dialog */}
      <Dialog open={!!selectedLead} onOpenChange={handleLeadDialogChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle del Lead</DialogTitle>
            <DialogDescription>
              Informacion completa y acciones disponibles
            </DialogDescription>
          </DialogHeader>
          {selectedLead && (
            <LeadDetail
              lead={selectedLead}
              onStatusChange={handleStatusChange}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* New Lead Dialog */}
      <LeadFormDialog open={showNewDialog} onOpenChange={setShowNewDialog} />

      {/* Delete Confirmation */}
      <AlertDialog open={!!leadToDelete} onOpenChange={() => setLeadToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar Lead</AlertDialogTitle>
            <AlertDialogDescription>
              Esta accion no se puede deshacer. Se eliminara permanentemente el lead{' '}
              <strong>{leadToDelete?.name}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </div>
  )
}
