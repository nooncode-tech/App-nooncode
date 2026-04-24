'use client'

import React from "react"

import type { Lead, LeadStatus } from '@/lib/types'
import { useAuth } from '@/lib/auth-context'
import { formatLeadFollowUpDateTime, getLeadFollowUpState } from '@/lib/leads/follow-up'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  Building2,
  Mail,
  Phone,
  MoreVertical,
  ArrowRight,
  MessageSquare,
  FileText,
  Calendar,
  Trash2,
  MapPin,
} from 'lucide-react'

interface LeadCardProps {
  lead: Lead
  onClick: () => void
  onStatusChange: (leadId: string, newStatus: LeadStatus) => void
  onDelete?: () => void
  distanceKm?: number
}

const statusConfig: Record<LeadStatus, { label: string; color: string }> = {
  new: { label: 'Nuevo', color: 'bg-blue-500/10 text-blue-700 border-blue-200' },
  contacted: { label: 'Contactado', color: 'bg-amber-500/10 text-amber-700 border-amber-200' },
  qualified: { label: 'Calificado', color: 'bg-primary/10 text-primary border-primary/20' },
  proposal: { label: 'Propuesta', color: 'bg-orange-500/10 text-orange-700 border-orange-200' },
  negotiation: { label: 'Negociacion', color: 'bg-accent/10 text-accent border-accent/20' },
  won: { label: 'Ganado', color: 'bg-emerald-500/10 text-emerald-700 border-emerald-200' },
  lost: { label: 'Perdido', color: 'bg-red-500/10 text-red-700 border-red-200' },
}

const nextStatus: Partial<Record<LeadStatus, LeadStatus>> = {
  new: 'contacted',
  contacted: 'qualified',
  qualified: 'proposal',
  proposal: 'negotiation',
  negotiation: 'won',
}

const assignmentStatusConfig = {
  owned: { label: 'Tomado', color: 'bg-slate-500/10 text-slate-700 border-slate-200' },
  proposal_locked: { label: 'Bloqueado por propuesta', color: 'bg-amber-500/10 text-amber-700 border-amber-200' },
  released_no_response: { label: 'Liberado', color: 'bg-primary/10 text-primary border-primary/20' },
} as const

const followUpStateConfig = {
  scheduled: { label: 'Seguimiento programado', color: 'bg-sky-500/10 text-sky-700 border-sky-200' },
  due_today: { label: 'Vence hoy', color: 'bg-amber-500/10 text-amber-700 border-amber-200' },
  overdue: { label: 'Atrasado', color: 'bg-red-500/10 text-red-700 border-red-200' },
} as const

function isValidLeadEmail(email: string | undefined): boolean {
  if (!email) {
    return false
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function buildGmailComposeUrl(email: string): string {
  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: email,
  })

  return `https://mail.google.com/mail/?${params.toString()}`
}

export function LeadCard({ lead, onClick, onStatusChange, onDelete, distanceKm }: LeadCardProps) {
  const { authMode, user } = useAuth()
  const statusInfo = statusConfig[lead.status]
  const assignmentInfo = assignmentStatusConfig[lead.assignmentStatus]
  const next = nextStatus[lead.status]
  const isSupabaseMode = authMode === 'supabase'
  const hasValidEmail = isValidLeadEmail(lead.email)
  const followUpState = getLeadFollowUpState(lead.nextFollowUpAt)
  const isReleasedLeadPendingClaim =
    user?.role === 'sales' &&
    lead.assignmentStatus === 'released_no_response' &&
    lead.assignedTo !== user.id

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-700 bg-emerald-500/10'
    if (score >= 60) return 'text-amber-700 bg-amber-500/10'
    if (score >= 40) return 'text-orange-700 bg-orange-500/10'
    return 'text-red-700 bg-red-500/10'
  }

  const handleQuickAction = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

  const handleOpenGmail = (event?: Event | React.MouseEvent) => {
    event?.stopPropagation()

    if (!hasValidEmail) {
      return
    }

    window.open(buildGmailComposeUrl(lead.email), '_blank', 'noopener,noreferrer')
  }

  const handleOpenLeadDetail = (event?: Event | React.MouseEvent) => {
    event?.stopPropagation()
    onClick()
  }

  return (
    <Card
      className="p-4 cursor-pointer transition-colors duration-150 hover:bg-muted/20"
      onClick={onClick}
    >
      <div className="flex items-start gap-4">
        {/* Score Badge */}
        <div
          className={cn(
            'size-12 rounded-lg flex items-center justify-center font-bold text-lg shrink-0',
            getScoreColor(lead.score)
          )}
        >
          {lead.score}
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold truncate">{lead.name}</h3>
              {lead.company && (
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Building2 className="size-3" />
                  {lead.company}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {lead.assignmentStatus !== 'owned' && (
                <Badge variant="outline" className={assignmentInfo.color}>
                  {assignmentInfo.label}
                </Badge>
              )}
              <Badge variant="outline" className={statusInfo.color}>
                {statusInfo.label}
              </Badge>
              <span className="font-semibold text-primary">
                ${lead.value.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Contact Info */}
          <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Mail className="size-3" />
              {lead.email}
            </span>
            {lead.phone && (
              <span className="flex items-center gap-1">
                <Phone className="size-3" />
                {lead.phone}
              </span>
            )}
            {lead.whatsapp && (
              <a
                href={`https://wa.me/${lead.whatsapp.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-green-600 hover:text-green-700"
                onClick={(e) => e.stopPropagation()}
              >
                <MessageSquare className="size-3" />
                WA
              </a>
            )}
          </div>

          {/* Tags */}
          {lead.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {lead.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {lead.nextFollowUpAt && followUpState && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className={followUpStateConfig[followUpState].color}>
                {followUpStateConfig[followUpState].label}
              </Badge>
              <span className="flex items-center gap-1 text-muted-foreground">
                <Calendar className="size-3" />
                {formatLeadFollowUpDateTime(lead.nextFollowUpAt)}
              </span>
            </div>
          )}
          {distanceKm !== undefined && (
            <div className="mt-1 flex items-center gap-1 text-xs text-sky-600">
              <MapPin className="size-3" />
              {distanceKm < 1
                ? `${Math.round(distanceKm * 1000)} m`
                : `${distanceKm.toFixed(1)} km`}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-1 shrink-0" onClick={handleQuickAction}>
          {next && (
            <Button
              size="sm"
              variant="ghost"
              className="text-xs"
              disabled={isReleasedLeadPendingClaim}
              onClick={(e) => {
                e.stopPropagation()
                onStatusChange(lead.id, next)
              }}
            >
              <ArrowRight className="size-3 mr-1" />
              {statusConfig[next].label}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="size-8">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Acciones</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!hasValidEmail}
                onSelect={(event) => handleOpenGmail(event)}
              >
                <MessageSquare className="size-4 mr-2" />
                Abrir en Gmail
              </DropdownMenuItem>
              {isSupabaseMode ? (
                <>
                  <DropdownMenuItem disabled>
                    <Phone className="size-4 mr-2" />
                    Llamar no disponible
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={(event) => handleOpenLeadDetail(event)}>
                    <FileText className="size-4 mr-2" />
                    Abrir detalle para propuesta
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={(event) => handleOpenLeadDetail(event)}>
                    <Calendar className="size-4 mr-2" />
                    Abrir detalle para seguimiento
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem>
                    <Phone className="size-4 mr-2" />
                    Llamar
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <FileText className="size-4 mr-2" />
                    Generar propuesta
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Calendar className="size-4 mr-2" />
                    Agendar reunion
                  </DropdownMenuItem>
                </>
              )}
              {onDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete()
                    }}
                  >
                    <Trash2 className="size-4 mr-2" />
                    Eliminar
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Cambiar estado</DropdownMenuLabel>
              {Object.entries(statusConfig).map(([status, config]) => (
                <DropdownMenuItem
                  key={status}
                  onClick={(e) => {
                    e.stopPropagation()
                    onStatusChange(lead.id, status as LeadStatus)
                  }}
                  disabled={status === lead.status || isReleasedLeadPendingClaim}
                >
                  {config.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </Card>
  )
}
