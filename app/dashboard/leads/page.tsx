'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { buildLeadDetailHref, clearDashboardEntityHref } from '@/lib/dashboard-navigation'
import { useData } from '@/lib/data-context'
import type { Lead, LeadStatus } from '@/lib/types'
import {
  leadStatusLabels,
  selectLeadList,
  selectLeadsSummary,
  haversineKm,
  type LeadSortOption,
  type LeadStatusFilter,
} from '@/lib/dashboard-selectors'
import type { LeadWire } from '@/lib/leads/serialization'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
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
  MapPin,
  Sparkles,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'

const maxwellStages = [
  'Detectando ubicacion',
  'Buscando candidatos',
  'Auditando negocios',
  'Filtrando leads',
  'Generando lead cards',
  'Guardando leads',
] as const

interface MaxwellSearchResponse {
  data: {
    runId: string
    status: 'completed' | 'insufficient' | 'needs_review' | 'failed'
    leads: LeadWire[]
    counts: {
      candidatesFound: number
      candidatesAudited: number
      duplicatesFound: number
      rejected: number
      published: number
    }
    radiusKm: number
    message: string
  }
}

export default function LeadsPage() {
  const { user } = useAuth()
  const { leads, isLeadsLoading, refreshLeads, updateLeadStatus, deleteLead } = useData()
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
  const [isMaxwellSearching, setIsMaxwellSearching] = useState(false)
  const [maxwellStageIndex, setMaxwellStageIndex] = useState(0)
  const [manualZoneOpen, setManualZoneOpen] = useState(false)
  const [manualZoneText, setManualZoneText] = useState('')
  const [lastMaxwellResult, setLastMaxwellResult] = useState<MaxwellSearchResponse['data'] | null>(null)
  const requestedLeadId = searchParams.get('leadId')

  const replaceLeadHref = useCallback((leadId: string | null) => {
    const nextHref = leadId
      ? buildLeadDetailHref(leadId, searchParams)
      : clearDashboardEntityHref(pathname, searchParams, 'leadId')

    router.replace(nextHref, { scroll: false })
  }, [pathname, router, searchParams])

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
  }, [leads, replaceLeadHref, requestedLeadId, selectedLead])

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
  }, [isLeadsLoading, leads, replaceLeadHref, requestedLeadId, selectedLead])

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

  const runMaxwellSearch = async (
    payload:
      | { mode: 'current_location'; latitude: number; longitude: number; locale: string }
      | { mode: 'manual_zone'; zoneText: string; locale: string }
  ) => {
    setIsMaxwellSearching(true)
    setMaxwellStageIndex(0)
    setLastMaxwellResult(null)

    const stageTimer = window.setInterval(() => {
      setMaxwellStageIndex((current) => Math.min(current + 1, maxwellStages.length - 1))
    }, 1600)

    try {
      const response = await fetch('/api/maxwell/lead-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(
          json && typeof json.error === 'string'
            ? json.error
            : 'Maxwell no pudo completar la busqueda.'
        )
      }

      const result = (json as MaxwellSearchResponse).data
      setLastMaxwellResult(result)
      await refreshLeads()

      if (result.status === 'completed') {
        toast.success(result.message)
      } else {
        toast.info(result.message)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Maxwell no pudo completar la busqueda.')
    } finally {
      window.clearInterval(stageTimer)
      setMaxwellStageIndex(maxwellStages.length - 1)
      setIsMaxwellSearching(false)
    }
  }

  const handleMaxwellCurrentLocationSearch = () => {
    if (!navigator.geolocation) {
      setManualZoneOpen(true)
      toast.info('Tu navegador no soporta geolocalizacion. Usa una zona manual.')
      return
    }

    setIsGeoLoading(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsGeoLoading(false)
        void runMaxwellSearch({
          mode: 'current_location',
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          locale: navigator.language || 'es-MX',
        })
      },
      () => {
        setIsGeoLoading(false)
        setManualZoneOpen(true)
        toast.info('No se pudo obtener tu ubicacion. Usa una zona manual.')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 120000 }
    )
  }

  const handleManualZoneSearch = () => {
    const zoneText = manualZoneText.trim()
    if (!zoneText) {
      toast.error('Escribe una zona para buscar leads.')
      return
    }

    setManualZoneOpen(false)
    void runMaxwellSearch({
      mode: 'manual_zone',
      zoneText,
      locale: navigator.language || 'es-MX',
    })
  }

  if (!user) return null

  const radiusKm =
    lastMaxwellResult?.radiusKm ??
    (user.role === 'admin' || user.role === 'pm'
      ? 100
      : user.role === 'sales_manager'
        ? 75
        : 5)

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
    <div className="app-page">
      <div className="app-page-header">
        <div>
          <h1 className="app-page-title">Leads</h1>
          <p className="app-page-subtitle">Cola comercial, prioridad por score y seguimiento activo.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="default"
            onClick={handleMaxwellCurrentLocationSearch}
            disabled={isGeoLoading || isMaxwellSearching}
          >
            {isGeoLoading || isMaxwellSearching ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="size-4 mr-2" />
            )}
            Buscar leads cerca de mi
          </Button>
          <Button
            variant="outline"
            onClick={() => setManualZoneOpen(true)}
            disabled={isMaxwellSearching}
          >
            <MapPin className="size-4 mr-2" />
            Buscar por zona
          </Button>
          <LeadImportDialog onImported={() => {}} />
          <Button onClick={() => setShowNewDialog(true)}>
            <Plus className="size-4 mr-2" />
            Nuevo Lead
          </Button>
        </div>
      </div>
      <div className="app-section">

      {(isMaxwellSearching || lastMaxwellResult) && (
        <Card className="p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium">
                {isMaxwellSearching ? maxwellStages[maxwellStageIndex] : 'Busqueda Maxwell completada'}
              </p>
              <p className="text-xs text-muted-foreground">
                {isMaxwellSearching
                  ? 'Maxwell audita negocios cercanos y descarta oportunidades sin evidencia suficiente.'
                  : lastMaxwellResult?.message}
              </p>
            </div>
            {lastMaxwellResult && !isMaxwellSearching && (
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>Radio: {lastMaxwellResult.radiusKm} km</span>
                <span>Candidatos: {lastMaxwellResult.counts.candidatesFound}</span>
                <span>Auditados: {lastMaxwellResult.counts.candidatesAudited}</span>
                <span>Publicados: {lastMaxwellResult.counts.published}</span>
              </div>
            )}
          </div>
          {isMaxwellSearching && (
            <Progress
              className="mt-3"
              value={((maxwellStageIndex + 1) / maxwellStages.length) * 100}
            />
          )}
        </Card>
      )}

      {/* Stats row */}
      <div className="metric-grid">
        <div className="metric-card-primary">
          <p className="metric-label-inverse">Leads abiertos</p>
          <p className="metric-value-inverse">{totalLeads}</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">High score</p>
          <p className="metric-value">{highScoreLeads}</p>
          <p className="metric-note">Score 80+</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">Score promedio</p>
          <p className="metric-value">{avgScore}</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">Pipeline</p>
          <p className="metric-value">${pipelineValue.toLocaleString()}</p>
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

      <Dialog open={manualZoneOpen} onOpenChange={setManualZoneOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Buscar leads por zona</DialogTitle>
            <DialogDescription>
              Maxwell usara esta zona como centro y respetara tu radio permitido en servidor.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="maxwell-zone">Zona</Label>
            <Input
              id="maxwell-zone"
              value={manualZoneText}
              onChange={(event) => setManualZoneText(event.target.value)}
              placeholder="Ej. Downtown Austin, TX"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setManualZoneOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleManualZoneSearch} disabled={isMaxwellSearching}>
              Buscar leads
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
