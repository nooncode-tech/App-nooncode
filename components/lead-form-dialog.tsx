'use client'

import React from "react"

import { useState } from 'react'
import { useData } from '@/lib/data-context'
import type { LeadDraft, LeadOrigin, LeadSource, LeadSourceInput, LeadStatus, LeadUpdates } from '@/lib/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'

interface LeadFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editLead?: {
    id: string
    name: string
    email: string
    phone?: string
    company?: string
    source: LeadSource
    value: number
    notes?: string
    tags: string[]
    leadOrigin?: LeadOrigin
  }
}

const sources: { value: LeadSourceInput; label: string }[] = [
  { value: 'website', label: 'Sitio Web' },
  { value: 'referral', label: 'Referido' },
  { value: 'social_media', label: 'Redes Sociales' },
  { value: 'cold_outreach', label: 'Contacto Frio' },
  { value: 'event', label: 'Evento' },
  { value: 'other', label: 'Otro' },
]

interface LeadFormState {
  name: string
  email: string
  phone: string
  company: string
  source: LeadSourceInput
  value: string
  notes: string
  tags: string
  locationText: string
  leadOrigin: LeadOrigin
}

function createEmptyFormData(): LeadFormState {
  return {
    name: '',
    email: '',
    phone: '',
    company: '',
    source: 'website',
    value: '',
    notes: '',
    tags: '',
    locationText: '',
    leadOrigin: 'inbound',
  }
}

async function geocodeLocation(locationText: string): Promise<{ latitude: number; longitude: number; displayName: string } | null> {
  try {
    const encoded = encodeURIComponent(locationText)
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`,
      { headers: { 'User-Agent': 'NoonApp/1.0' } }
    )
    const data = await res.json()
    if (Array.isArray(data) && data.length > 0) {
      return {
        latitude: parseFloat(data[0].lat),
        longitude: parseFloat(data[0].lon),
        displayName: data[0].display_name,
      }
    }
    return null
  } catch {
    return null
  }
}

export function LeadFormDialog({ open, onOpenChange, editLead }: LeadFormDialogProps) {
  const { addLead, updateLead } = useData()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [geoPreview, setGeoPreview] = useState<string | null>(null)
  const [isGeocoding, setIsGeocoding] = useState(false)
  const [geoCoords, setGeoCoords] = useState<{ latitude: number; longitude: number } | null>(null)
  const geocodeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const [formData, setFormData] = useState<LeadFormState>({
    name: editLead?.name || '',
    email: editLead?.email || '',
    phone: editLead?.phone || '',
    company: editLead?.company || '',
    source: editLead?.source || 'website',
    value: editLead?.value?.toString() || '',
    notes: editLead?.notes || '',
    tags: editLead?.tags?.join(', ') || '',
    locationText: '',
    leadOrigin: editLead?.leadOrigin || 'inbound',
  })

  const handleLocationChange = (value: string) => {
    setFormData((prev) => ({ ...prev, locationText: value }))
    setGeoPreview(null)
    if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current)
    const trimmed = value.trim()
    if (!trimmed) return
    setIsGeocoding(true)
    geocodeTimerRef.current = setTimeout(async () => {
      const result = await geocodeLocation(trimmed)
      setIsGeocoding(false)
      if (result) {
        setGeoPreview(result.displayName)
        setGeoCoords({ latitude: result.latitude, longitude: result.longitude })
      } else {
        setGeoPreview('__not_found__')
        setGeoCoords(null)
      }
    }, 800)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const trimmedLocation = formData.locationText.trim()

      const leadData: LeadDraft = {
        name: formData.name,
        email: formData.email,
        phone: formData.phone || undefined,
        company: formData.company || undefined,
        source: formData.source,
        value: Number.parseFloat(formData.value) || 0,
        notes: formData.notes || undefined,
        tags: formData.tags ? formData.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        score: Math.floor(Math.random() * 40) + 60,
        status: 'new' as LeadStatus,
        assignedTo: undefined,
        locationText: trimmedLocation || undefined,
        latitude: geoCoords?.latitude,
        longitude: geoCoords?.longitude,
        leadOrigin: formData.leadOrigin,
      }

      if (editLead) {
        const leadUpdates: LeadUpdates = leadData
        await updateLead(editLead.id, leadUpdates)
        toast.success('Lead actualizado correctamente')
      } else {
        await addLead(leadData)
        toast.success('Lead creado correctamente')
      }

      onOpenChange(false)
      setFormData(createEmptyFormData())
      setGeoPreview(null)
      setGeoCoords(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar el lead')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{editLead ? 'Editar Lead' : 'Nuevo Lead'}</DialogTitle>
          <DialogDescription>
            {editLead
              ? 'Actualiza la informacion del lead'
              : 'Ingresa los datos del nuevo prospecto'}
          </DialogDescription>
        </DialogHeader>

        <form id="lead-form" onSubmit={handleSubmit} className="space-y-4 overflow-y-auto flex-1 pr-1">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Juan Perez"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="juan@empresa.com"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Telefono</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
                placeholder="+52 55 1234 5678"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company">Empresa</Label>
              <Input
                id="company"
                value={formData.company}
                onChange={(e) => setFormData((prev) => ({ ...prev, company: e.target.value }))}
                placeholder="Empresa SA"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="source">Fuente</Label>
              <Select
                value={formData.source}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, source: value as LeadSourceInput }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona fuente" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((source) => (
                    <SelectItem key={source.value} value={source.value}>
                      {source.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="value">Valor estimado ($)</Label>
              <Input
                id="value"
                type="number"
                value={formData.value}
                onChange={(e) => setFormData((prev) => ({ ...prev, value: e.target.value }))}
                placeholder="10000"
                min="0"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="leadOrigin">
              Origen del lead <span className="text-destructive">*</span>
            </Label>
            <Select
              value={formData.leadOrigin}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, leadOrigin: value as LeadOrigin }))}
              disabled={!!editLead}
            >
              <SelectTrigger id="leadOrigin">
                <SelectValue placeholder="Selecciona origen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inbound">Inbound — el cliente llegó solo</SelectItem>
                <SelectItem value="outbound">Outbound — el vendedor lo contactó</SelectItem>
              </SelectContent>
            </Select>
            {editLead && (
              <p className="text-xs text-muted-foreground">El origen no se puede modificar una vez guardado.</p>
            )}
            {!editLead && (
              <p className="text-xs text-muted-foreground">
                {formData.leadOrigin === 'outbound'
                  ? 'Outbound: se acredita $100 USD al vendedor al confirmar el pago.'
                  : 'Inbound: sin comisión para el vendedor.'}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Etiquetas (separadas por coma)</Label>
            <Input
              id="tags"
              value={formData.tags}
              onChange={(e) => setFormData((prev) => ({ ...prev, tags: e.target.value }))}
              placeholder="web, urgente, premium"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="locationText">Ubicación</Label>
            <Input
              id="locationText"
              value={formData.locationText}
              onChange={(e) => handleLocationChange(e.target.value)}
              placeholder="Monterrey NL, México"
            />
            {isGeocoding && (
              <p className="text-xs text-muted-foreground">Buscando ubicación...</p>
            )}
            {!isGeocoding && geoPreview === '__not_found__' && (
              <p className="text-xs text-destructive">Ubicación no encontrada. Verifica el texto.</p>
            )}
            {!isGeocoding && geoPreview && geoPreview !== '__not_found__' && (
              <p className="text-xs text-green-600">📍 {geoPreview}</p>
            )}
            {!isGeocoding && !geoPreview && (
              <p className="text-xs text-muted-foreground">Se usará para el filtro de proximidad</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notas</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Informacion adicional sobre el prospecto..."
              rows={3}
            />
          </div>

        </form>
        <DialogFooter className="pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="lead-form" disabled={isSubmitting}>
            {isSubmitting ? 'Guardando...' : editLead ? 'Actualizar' : 'Crear Lead'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
