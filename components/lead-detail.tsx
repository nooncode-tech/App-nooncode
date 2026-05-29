'use client'

import Link from 'next/link'
import { startTransition, useEffect, useState } from 'react'
import { canAccessDashboardPath, useAuth } from '@/lib/auth-context'
import { buildProjectDetailHref } from '@/lib/dashboard-navigation'
import { useData } from '@/lib/data-context'
import {
  formatLeadFollowUpDateTime,
  getLeadFollowUpState,
  parseDateTimeLocalValue,
  toDateTimeLocalValue,
} from '@/lib/leads/follow-up'
import type {
  Lead,
  LeadActivity,
  LeadAssignmentStatus,
  LeadProposal,
  LeadStatus,
  ProjectStatus,
  ProposalStatus,
} from '@/lib/types'
import {
  deriveEffectiveProposalState,
  manualProposalStatusOptions,
} from '@/lib/leads/proposal-presentation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LeadPrototypeCard } from '@/components/lead-prototype-card'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  COMPLEXITY_LABELS,
  PROJECT_TYPE_LABELS,
  computePricing,
  type Complexity,
  type ProjectType,
  type SellerFeeAmount,
} from '@/lib/maxwell/pricing'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  Building2,
  Mail,
  Phone,
  Calendar,
  Clock,
  Tag,
  MessageSquare,
  FileText,
  Sparkles,
  Send,
  Copy,
  CheckCircle2,
  History,
  Loader2,
  ArrowRightLeft,
  FolderKanban,
  LockKeyhole,
  Undo2,
  UserPlus,
  MapPin,
  CreditCard,
  ShieldCheck,
  ShieldX,
  Timer,
  ExternalLink,
  Volume2,
  Square,
  ThumbsUp,
  Flag,
} from 'lucide-react'

interface LeadDetailProps {
  lead: Lead
  onStatusChange: (leadId: string, newStatus: LeadStatus) => Promise<Lead> | void
}

function formatCheckoutLinkExpiry(expiresAt: Date, now: Date = new Date()): string {
  const deltaMs = expiresAt.getTime() - now.getTime()
  const twelveHoursMs = 12 * 60 * 60 * 1000
  if (deltaMs > 0 && deltaMs < twelveHoursMs) {
    const totalMinutes = Math.floor(deltaMs / (60 * 1000))
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    if (hours > 0) {
      return `Vence en ${hours}h ${minutes}m`
    }
    return `Vence en ${minutes}m`
  }
  const day = expiresAt.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })
  const time = expiresAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `Vence el ${day} ${time}`
}

const statusConfig: Record<LeadStatus, { label: string; color: string }> = {
  prospect: { label: 'Prospecto', color: 'bg-sky-500/10 text-sky-700' },
  new: { label: 'Nuevo', color: 'bg-blue-500/10 text-blue-700' },
  contacted: { label: 'Contactado', color: 'bg-amber-500/10 text-amber-700' },
  qualified: { label: 'Calificado', color: 'bg-primary/10 text-primary' },
  proposal: { label: 'Propuesta', color: 'bg-orange-500/10 text-orange-700' },
  negotiation: { label: 'Negociacion', color: 'bg-accent/10 text-accent' },
  won: { label: 'Ganado', color: 'bg-emerald-500/10 text-emerald-700' },
  lost: { label: 'Perdido', color: 'bg-red-500/10 text-red-700' },
}

// Defensive fallback for unknown lead_status values (DB enum can drift
// ahead of the TS union — see 2026-05-27 prospect crash). Returns the raw
// status as the label so the operator can identify the missing mapping.
const unknownStatusInfo = (status: string) => ({
  label: status,
  color: 'bg-muted text-muted-foreground',
})

const sourceLabels: Record<string, string> = {
  website: 'Sitio Web',
  referral: 'Referido',
  cold_call: 'Llamada Fria',
  social: 'Redes Sociales',
  event: 'Evento',
  other: 'Otro',
  maxwell: 'Maxwell',
}

const leadFieldLabels: Record<string, string> = {
  name: 'nombre',
  email: 'email',
  phone: 'telefono',
  company: 'empresa',
  source: 'origen',
  score: 'score',
  value: 'valor',
  assignedTo: 'asignacion',
  notes: 'notas base',
  tags: 'tags',
  lastContactedAt: 'ultimo contacto',
  nextFollowUpAt: 'proximo seguimiento',
}

const proposalStatusConfig: Record<ProposalStatus, { label: string; color: string }> = {
  draft: { label: 'Borrador', color: 'bg-slate-500/10 text-slate-700' },
  sent: { label: 'Enviada', color: 'bg-blue-500/10 text-blue-700' },
  accepted: { label: 'Aceptada', color: 'bg-emerald-500/10 text-emerald-700' },
  rejected: { label: 'Rechazada', color: 'bg-red-500/10 text-red-700' },
  handoff_ready: { label: 'Lista para hand-off', color: 'bg-primary/10 text-primary' },
}

const speechVariantLabels = {
  inPerson: 'Presencial',
  phoneCall: 'Llamada',
  whatsapp: 'WhatsApp',
} as const

type SpeechVariant = keyof typeof speechVariantLabels

function getVigenciaLabel(expiresAt: Date | undefined, firstOpenedAt: Date | undefined): string | null {
  if (!firstOpenedAt || !expiresAt) return null
  const msLeft = expiresAt.getTime() - Date.now()
  if (msLeft <= 0) return 'Expirada'
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24))
  return `Vence en ${daysLeft} día${daysLeft !== 1 ? 's' : ''}`
}

const projectStatusLabels: Record<ProjectStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'En progreso',
  review: 'Revision',
  delivered: 'Entregado',
  completed: 'Completado',
}

const assignmentStatusConfig: Record<LeadAssignmentStatus, { label: string; color: string }> = {
  owned: { label: 'Lead tomado', color: 'bg-slate-500/10 text-slate-700 border-slate-200' },
  proposal_locked: {
    label: 'Bloqueado por propuesta',
    color: 'bg-amber-500/10 text-amber-700 border-amber-200',
  },
  released_no_response: {
    label: 'Liberado por falta de respuesta',
    color: 'bg-primary/10 text-primary border-primary/20',
  },
}

const followUpStateConfig = {
  scheduled: {
    label: 'Seguimiento programado',
    color: 'bg-sky-500/10 text-sky-700 border-sky-200',
    helper: 'Hay un seguimiento agendado para este lead.',
  },
  due_today: {
    label: 'Vence hoy',
    color: 'bg-amber-500/10 text-amber-700 border-amber-200',
    helper: 'El siguiente seguimiento vence hoy. No deberia quedar sin tocar.',
  },
  overdue: {
    label: 'Atrasado',
    color: 'bg-red-500/10 text-red-700 border-red-200',
    helper: 'El seguimiento programado ya vencio y requiere accion comercial.',
  },
} as const

function buildDefaultProposalTitle(lead: Lead) {
  return `Propuesta - ${lead.company || lead.name}`
}

// Resolves the seller fee amount to send to the proposal API based on the
// lead's origin. For inbound leads, no fee is sent (the API treats absence
// as "not applicable"). For outbound, the form value is parsed; if invalid
// for any reason, defaults to 100 (preserves prior behavior). The DB CHECK
// constraint on seller_fees.amount catches anything that slips through.
function resolveSellerFeeAmountForOutbound(
  lead: Lead,
  formValue: string,
): 100 | 300 | 500 | undefined {
  if (lead.leadOrigin !== 'outbound') {
    return undefined
  }
  const parsed = Number.parseInt(formValue, 10)
  if (parsed === 100 || parsed === 300 || parsed === 500) {
    return parsed
  }
  return 100
}

function getChangedFields(metadata: LeadActivity['metadata']): string[] {
  const changedFields = metadata?.changedFields

  if (!Array.isArray(changedFields)) {
    return []
  }

  return changedFields.filter((value): value is string => typeof value === 'string')
}

function getStatusTransition(metadata: LeadActivity['metadata']) {
  const fromStatus = metadata?.fromStatus
  const toStatus = metadata?.toStatus

  return {
    fromStatus: typeof fromStatus === 'string' ? (fromStatus as LeadStatus) : null,
    toStatus: typeof toStatus === 'string' ? (toStatus as LeadStatus) : null,
  }
}

function getProposalStatusTransition(metadata: LeadActivity['metadata']) {
  const fromStatus = metadata?.fromStatus
  const toStatus = metadata?.toStatus

  return {
    fromStatus: typeof fromStatus === 'string' ? (fromStatus as ProposalStatus) : null,
    toStatus: typeof toStatus === 'string' ? (toStatus as ProposalStatus) : null,
  }
}

function formatActivityTitle(activity: LeadActivity) {
  if (activity.type === 'created') {
    return 'Lead creado'
  }

  if (activity.type === 'note_added') {
    return 'Nota agregada'
  }

  if (activity.type === 'status_changed') {
    const { fromStatus, toStatus } = getStatusTransition(activity.metadata)
    const fromLabel = fromStatus
      ? (statusConfig[fromStatus] ?? unknownStatusInfo(fromStatus)).label
      : 'Sin estado'
    const toLabel = toStatus
      ? (statusConfig[toStatus] ?? unknownStatusInfo(toStatus)).label
      : 'Actualizado'
    return `Estado: ${fromLabel} -> ${toLabel}`
  }

  if (activity.type === 'proposal_created') {
    const title = typeof activity.metadata?.title === 'string' ? activity.metadata.title : 'Sin titulo'
    return `Propuesta creada: ${title}`
  }

  if (activity.type === 'proposal_status_changed') {
    const { fromStatus, toStatus } = getProposalStatusTransition(activity.metadata)
    const fromLabel = fromStatus ? proposalStatusConfig[fromStatus].label : 'Sin estado'
    const toLabel = toStatus ? proposalStatusConfig[toStatus].label : 'Actualizado'
    return `Propuesta: ${fromLabel} -> ${toLabel}`
  }

  if (activity.type === 'project_created') {
    const projectName = typeof activity.metadata?.projectName === 'string'
      ? activity.metadata.projectName
      : 'Sin nombre'
    return `Proyecto creado: ${projectName}`
  }

  if (activity.type === 'released_no_response') {
    return 'Lead liberado por falta de respuesta'
  }

  if (activity.type === 'claimed') {
    return 'Lead reclamado'
  }

  const changedFields = getChangedFields(activity.metadata)

  if (changedFields.length === 0) {
    return 'Lead actualizado'
  }

  const label = changedFields
    .map((field) => leadFieldLabels[field] ?? field)
    .join(', ')

  return `Actualizacion: ${label}`
}

function formatActivityBody(activity: LeadActivity) {
  if (activity.type === 'note_added') {
    return activity.noteBody ?? ''
  }

  if (activity.type === 'created') {
    return 'El lead quedo registrado en el pipeline persistente.'
  }

  if (activity.type === 'status_changed') {
    return `Movimiento registrado por ${activity.actorName}.`
  }

  if (activity.type === 'proposal_created') {
    return 'La propuesta comercial quedo vinculada al lead y lista para seguimiento.'
  }

  if (activity.type === 'proposal_status_changed') {
    return `Cambio de propuesta registrado por ${activity.actorName}.`
  }

  if (activity.type === 'project_created') {
    return 'El hand-off comercial se convirtio en un proyecto persistente para delivery.'
  }

  if (activity.type === 'released_no_response') {
    return 'El lead quedo disponible para que otro vendedor lo reclame.'
  }

  if (activity.type === 'claimed') {
    return `El lead fue reclamado y vuelve a tener responsable comercial.`
  }

  const changedFields = getChangedFields(activity.metadata)

  if (changedFields.length === 0) {
    return 'Se actualizaron datos del lead.'
  }

  return `Campos tocados: ${changedFields
    .map((field) => leadFieldLabels[field] ?? field)
    .join(', ')}.`
}

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

function buildPhoneCallUrl(phone: string): string {
  return `tel:${phone.trim()}`
}

function buildWhatsAppUrl(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return `https://wa.me/${digits}`
}

export function LeadDetail({ lead, onStatusChange }: LeadDetailProps) {
  const { authMode, user } = useAuth()
  const {
    updateLead,
    getLeadActivity,
    addLeadNote,
    getLeadProposals,
    addLeadProposal,
    updateLeadProposalStatus,
    claimLead,
    releaseLeadAsNoResponse,
    createProjectFromProposal,
  } = useData()
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedContent, setGeneratedContent] = useState('')
  const [noteText, setNoteText] = useState('')
  const [activities, setActivities] = useState<LeadActivity[]>([])
  const [proposals, setProposals] = useState<LeadProposal[]>([])
  const [isActivityLoading, setIsActivityLoading] = useState(true)
  const [isProposalsLoading, setIsProposalsLoading] = useState(true)
  const [isSavingNote, setIsSavingNote] = useState(false)
  const [isSavingProposal, setIsSavingProposal] = useState(false)
  const [isSavingFollowUp, setIsSavingFollowUp] = useState(false)
  const [isMutatingAssignment, setIsMutatingAssignment] = useState(false)
  const [creatingProjectProposalId, setCreatingProjectProposalId] = useState<string | null>(null)
  const [checkoutLoadingProposalId, setCheckoutLoadingProposalId] = useState<string | null>(null)
  const [prototypeRefreshKey, setPrototypeRefreshKey] = useState(0)
  const [activeTab, setActiveTab] = useState('activity')
  const [speechVariant, setSpeechVariant] = useState<SpeechVariant>('inPerson')
  const [isSpeechPlaying, setIsSpeechPlaying] = useState(false)
  const [isSavingMaxwellFeedback, setIsSavingMaxwellFeedback] = useState(false)
  const [followUpInput, setFollowUpInput] = useState(toDateTimeLocalValue(lead.nextFollowUpAt))
  const [proposalForm, setProposalForm] = useState<{
    title: string
    amount: string
    body: string
    sellerFeeAmount: string
    projectType: ProjectType | ''
    complexity: Complexity | ''
  }>({
    title: buildDefaultProposalTitle(lead),
    amount: lead.value.toString(),
    body: '',
    sellerFeeAmount: '100',
    projectType: '',
    complexity: '',
  })
  const isSupabaseMode = authMode === 'supabase'
  const hasValidEmail = isValidLeadEmail(lead.email)
  const gmailComposeUrl = hasValidEmail && lead.email ? buildGmailComposeUrl(lead.email) : null
  const phoneCallUrl = lead.phone?.trim() ? buildPhoneCallUrl(lead.phone) : null
  const whatsAppContact = (lead.whatsapp?.trim() || lead.phone?.trim()) ?? null
  const whatsAppUrl = whatsAppContact ? buildWhatsAppUrl(whatsAppContact) : null
  const assignmentInfo = assignmentStatusConfig[lead.assignmentStatus]
  const followUpState = getLeadFollowUpState(lead.nextFollowUpAt)
  const followUpInfo = followUpState ? followUpStateConfig[followUpState] : null
  const proposalsWithLinkedProject = proposals.filter((proposal) => proposal.linkedProject)
  const handoffReadyPendingProposals = proposals.filter(
    (proposal) => proposal.status === 'handoff_ready' && !proposal.linkedProject
  )
  const canOpenProjectsRoute = user ? canAccessDashboardPath(user.role, '/dashboard/projects') : false
  const lockedProposalTitle =
    proposals.find((proposal) => proposal.id === lead.lockedByProposalId)?.title ?? null
  const canManageAssignment =
    user?.role === 'admin' || user?.role === 'sales_manager' || user?.role === 'sales'
  const canReleaseLockedLead = canManageAssignment && lead.assignmentStatus === 'proposal_locked'
  const canClaimReleasedLead =
    canManageAssignment && lead.assignmentStatus === 'released_no_response'
  const isReleasedLeadPendingClaim =
    user?.role === 'sales' &&
    lead.assignmentStatus === 'released_no_response' &&
    lead.assignedTo !== user.id
  const maxwellSnapshot = lead.maxwellSnapshot
  const currentSpeech = maxwellSnapshot?.salesSpeech[speechVariant] ?? ''

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-700 bg-emerald-500/10'
    if (score >= 60) return 'text-amber-700 bg-amber-500/10'
    if (score >= 40) return 'text-orange-700 bg-orange-500/10'
    return 'text-red-700 bg-red-500/10'
  }

  const handleGenerateEmail = async () => {
    setIsGenerating(true)
    // Simulate AI generation
    await new Promise((resolve) => setTimeout(resolve, 1500))
    setGeneratedContent(`Estimado/a ${lead.name},

Espero que este mensaje le encuentre bien. Mi nombre es Juan Perez y me comunico de NoonApp.

He notado el crecimiento de ${lead.company || 'su empresa'} y creo que podriamos ayudarles a ${lead.notes || 'optimizar sus procesos digitales'}.

Me encantaria agendar una breve llamada de 15 minutos para explorar como podemos colaborar.

¿Le funcionaria esta semana?

Saludos cordiales,
Juan Perez
NoonApp`)
    setIsGenerating(false)
  }

  const handleGenerateProposal = async () => {
    setIsGenerating(true)
    await new Promise((resolve) => setTimeout(resolve, 2000))
    setGeneratedContent(`# Propuesta de Proyecto - ${lead.company || lead.name}

## Resumen Ejecutivo
Propuesta para ${lead.notes || 'desarrollo de solucion digital personalizada'}.

## Alcance del Proyecto
- Analisis de requerimientos
- Diseño de arquitectura
- Desarrollo e implementacion
- Testing y QA
- Deployment y soporte inicial

## Inversion
Valor estimado: $${lead.value.toLocaleString()} USD

## Timeline
- Fase 1: 2 semanas
- Fase 2: 4 semanas
- Fase 3: 2 semanas

Total: 8 semanas

## Proximos Pasos
1. Validar alcance con cliente
2. Firma de contrato
3. Kickoff del proyecto`)
    setIsGenerating(false)
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedContent)
    toast.success('Copiado al portapapeles')
  }

  const handleOpenGmail = () => {
    if (!hasValidEmail || !lead.email) {
      return
    }

    window.open(buildGmailComposeUrl(lead.email), '_blank', 'noopener,noreferrer')
  }

  const handleCopyText = async (text: string, successMessage = 'Copiado al portapapeles') => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(successMessage)
    } catch {
      toast.error('No se pudo copiar el texto')
    }
  }

  const handlePlaySpeech = () => {
    if (!currentSpeech.trim()) {
      return
    }

    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      toast.info('La reproduccion de voz no esta disponible en este navegador.')
      return
    }

    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(currentSpeech)
    utterance.lang = maxwellSnapshot?.salesSpeech.language ?? navigator.language ?? 'es-MX'
    utterance.onend = () => setIsSpeechPlaying(false)
    utterance.onerror = () => setIsSpeechPlaying(false)
    setIsSpeechPlaying(true)
    window.speechSynthesis.speak(utterance)
  }

  const handleStopSpeech = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setIsSpeechPlaying(false)
  }

  const handleMaxwellFeedback = async (
    rating: 'good' | 'bad' | 'duplicate' | 'not_relevant',
    note?: string
  ) => {
    setIsSavingMaxwellFeedback(true)

    try {
      const response = await fetch(`/api/leads/${lead.id}/maxwell-feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, note }),
      })
      const json = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(
          json && typeof json.error === 'string'
            ? json.error
            : 'No se pudo registrar el feedback.'
        )
      }

      toast.success('Feedback de Maxwell registrado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar el feedback.')
    } finally {
      setIsSavingMaxwellFeedback(false)
    }
  }

  useEffect(() => {
    let isActive = true

    startTransition(() => {
      setIsActivityLoading(true)
    })

    getLeadActivity(lead.id)
      .then((nextActivities) => {
        if (isActive) {
          setActivities(nextActivities)
        }
      })
      .catch((error) => {
        if (isActive) {
          toast.error(error instanceof Error ? error.message : 'No se pudo cargar el historial')
        }
      })
      .finally(() => {
        if (isActive) {
          setIsActivityLoading(false)
        }
      })

    return () => {
      isActive = false
    }
  }, [getLeadActivity, lead.id, lead.updatedAt])

  useEffect(() => {
    let isActive = true

    startTransition(() => {
      setIsProposalsLoading(true)
    })

    getLeadProposals(lead.id)
      .then((nextProposals) => {
        if (isActive) {
          setProposals(nextProposals)
        }
      })
      .catch((error) => {
        if (isActive) {
          toast.error(error instanceof Error ? error.message : 'No se pudieron cargar las propuestas')
        }
      })
      .finally(() => {
        if (isActive) {
          setIsProposalsLoading(false)
        }
      })

    return () => {
      isActive = false
    }
  }, [getLeadProposals, lead.id, lead.updatedAt])

  useEffect(() => {
    startTransition(() => {
      setProposalForm((prev) => ({
        title: prev.title || buildDefaultProposalTitle(lead),
        amount: prev.amount || lead.value.toString(),
        body: prev.body,
        sellerFeeAmount: prev.sellerFeeAmount || '100',
        projectType: prev.projectType,
        complexity: prev.complexity,
      }))
    })
  }, [lead])

  useEffect(() => {
    startTransition(() => {
      setFollowUpInput(toDateTimeLocalValue(lead.nextFollowUpAt))
    })
  }, [lead.nextFollowUpAt])

  useEffect(() => {
    if (!isSupabaseMode) {
      return
    }

    startTransition(() => {
      setIsGenerating(false)
      setGeneratedContent('')
    })
  }, [isSupabaseMode, lead.id])

  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [lead.id])

  const handleSaveNote = async () => {
    const trimmedNote = noteText.trim()

    if (!trimmedNote) {
      return
    }

    setIsSavingNote(true)

    try {
      const activity = await addLeadNote(lead.id, trimmedNote)
      setActivities((prev) => [activity, ...prev])
      toast.success('Nota guardada')
      setNoteText('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la nota')
    } finally {
      setIsSavingNote(false)
    }
  }

  const handleSaveFollowUp = async () => {
    const parsedFollowUp = parseDateTimeLocalValue(followUpInput)

    if (!parsedFollowUp) {
      toast.error('Ingresa una fecha y hora validas para el seguimiento')
      return
    }

    setIsSavingFollowUp(true)

    try {
      await updateLead(lead.id, { nextFollowUpAt: parsedFollowUp })
      toast.success('Seguimiento programado')
      void getLeadActivity(lead.id).then(setActivities).catch(() => {})
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el seguimiento')
    } finally {
      setIsSavingFollowUp(false)
    }
  }

  const handleClearFollowUp = async () => {
    setIsSavingFollowUp(true)

    try {
      await updateLead(lead.id, { nextFollowUpAt: null })
      setFollowUpInput('')
      toast.success('Seguimiento limpiado')
      void getLeadActivity(lead.id).then(setActivities).catch(() => {})
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo limpiar el seguimiento')
    } finally {
      setIsSavingFollowUp(false)
    }
  }

  const handleSaveProposal = async () => {
    const title = proposalForm.title.trim()
    const body = proposalForm.body.trim()

    if (!title || !body) {
      return
    }

    const isOutbound = lead.leadOrigin === 'outbound'
    const sellerFeeAmount = resolveSellerFeeAmountForOutbound(lead, proposalForm.sellerFeeAmount)

    // For outbound, the amount is derived from the canonical pricing
    // matrix per ADR-013. The seller cannot hand-edit it — the server
    // would reject any mismatch with PROPOSAL_AMOUNT_PRICING_MISMATCH.
    // For inbound, fall back to the lead value (no matrix coordinates
    // are collected for inbound flows).
    let computedAmount: number
    let projectType: ProjectType | undefined
    let complexity: Complexity | undefined

    if (isOutbound) {
      if (!proposalForm.projectType || !proposalForm.complexity) {
        toast.error('Selecciona el tipo de proyecto y la complejidad antes de guardar.')
        return
      }
      projectType = proposalForm.projectType as ProjectType
      complexity = proposalForm.complexity as Complexity
      const pricing = computePricing(
        projectType,
        complexity,
        'outbound',
        (sellerFeeAmount ?? 100) as SellerFeeAmount,
      )
      computedAmount = pricing.activationFinal
    } else {
      const parsed = Number.parseFloat(proposalForm.amount)
      computedAmount = Number.isFinite(parsed) ? parsed : lead.value
    }

    setIsSavingProposal(true)

    try {
      const proposal = await addLeadProposal(lead.id, {
        title,
        body,
        amount: computedAmount,
        currency: 'USD',
        status: 'draft',
        sellerFeeAmount,
        projectType,
        complexity,
      })
      setProposals((prev) => [proposal, ...prev])
      toast.success('Propuesta guardada')
      setProposalForm((prev) => ({
        title: buildDefaultProposalTitle(lead),
        amount: lead.value.toString(),
        body: '',
        sellerFeeAmount: prev.sellerFeeAmount,
        projectType: prev.projectType,
        complexity: prev.complexity,
      }))
      void getLeadActivity(lead.id).then(setActivities).catch(() => {})
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la propuesta')
    } finally {
      setIsSavingProposal(false)
    }
  }

  const handleSaveGeneratedProposal = async () => {
    if (!generatedContent.trim()) {
      return
    }

    const isOutbound = lead.leadOrigin === 'outbound'
    const sellerFeeAmount = resolveSellerFeeAmountForOutbound(lead, proposalForm.sellerFeeAmount)

    let computedAmount: number
    let projectType: ProjectType | undefined
    let complexity: Complexity | undefined

    if (isOutbound) {
      if (!proposalForm.projectType || !proposalForm.complexity) {
        toast.error('Selecciona el tipo de proyecto y la complejidad antes de guardar la propuesta generada.')
        return
      }
      projectType = proposalForm.projectType as ProjectType
      complexity = proposalForm.complexity as Complexity
      const pricing = computePricing(
        projectType,
        complexity,
        'outbound',
        (sellerFeeAmount ?? 100) as SellerFeeAmount,
      )
      computedAmount = pricing.activationFinal
    } else {
      computedAmount = lead.value
    }

    setIsSavingProposal(true)

    try {
      const proposal = await addLeadProposal(lead.id, {
        title: buildDefaultProposalTitle(lead),
        body: generatedContent,
        amount: computedAmount,
        currency: 'USD',
        status: 'draft',
        sellerFeeAmount,
        projectType,
        complexity,
      })
      setProposals((prev) => [proposal, ...prev])
      toast.success('Propuesta guardada desde IA')
      void getLeadActivity(lead.id).then(setActivities).catch(() => {})
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la propuesta')
    } finally {
      setIsSavingProposal(false)
    }
  }

  const handleProposalStatusChange = async (proposalId: string, status: ProposalStatus) => {
    try {
      const updatedProposal = await updateLeadProposalStatus(lead.id, proposalId, status)
      setProposals((prev) =>
        prev.map((proposal) => (proposal.id === proposalId ? updatedProposal : proposal))
      )
      toast.success('Estado de propuesta actualizado')
      void getLeadActivity(lead.id).then(setActivities).catch(() => {})
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la propuesta')
    }
  }

  const handleReviewProposal = async (proposalId: string, action: 'approve' | 'reject' | 'cancel') => {
    try {
      const res = await fetch(`/api/proposals/${proposalId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'No se pudo revisar la propuesta')
        return
      }
      const updated: LeadProposal = {
        ...json.data,
        createdAt: new Date(json.data.createdAt),
        updatedAt: new Date(json.data.updatedAt),
        sentAt: json.data.sentAt ? new Date(json.data.sentAt) : undefined,
        acceptedAt: json.data.acceptedAt ? new Date(json.data.acceptedAt) : undefined,
        handoffReadyAt: json.data.handoffReadyAt ? new Date(json.data.handoffReadyAt) : undefined,
        firstOpenedAt: json.data.firstOpenedAt ? new Date(json.data.firstOpenedAt) : undefined,
        expiresAt: json.data.expiresAt ? new Date(json.data.expiresAt) : undefined,
        reviewedAt: json.data.reviewedAt ? new Date(json.data.reviewedAt) : undefined,
      }
      setProposals((prev) => prev.map((p) => (p.id === proposalId ? updated : p)))
      const labels = { approve: 'aprobada', reject: 'rechazada', cancel: 'cancelada' }
      toast.success(`Propuesta ${labels[action]}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al revisar propuesta')
    }
  }

  const handleReleaseLead = async () => {
    setIsMutatingAssignment(true)

    try {
      await releaseLeadAsNoResponse(lead.id)
      toast.success('Lead liberado como sin respuesta')
      void getLeadActivity(lead.id).then(setActivities).catch(() => {})
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo liberar el lead')
    } finally {
      setIsMutatingAssignment(false)
    }
  }

  const handleClaimLead = async () => {
    setIsMutatingAssignment(true)

    try {
      await claimLead(lead.id)
      toast.success('Lead reclamado correctamente')
      void getLeadActivity(lead.id).then(setActivities).catch(() => {})
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo reclamar el lead')
    } finally {
      setIsMutatingAssignment(false)
    }
  }

  const handleCreateProject = async (proposalId: string) => {
    setCreatingProjectProposalId(proposalId)

    try {
      const project = await createProjectFromProposal(lead.id, proposalId)
      setPrototypeRefreshKey((current) => current + 1)
      toast.success(`Proyecto listo: ${project.name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear el proyecto')
    } finally {
      setCreatingProjectProposalId(null)
    }
  }

  const handleRequestPayment = async (proposal: LeadProposal) => {
    if (!isSupabaseMode) return
    setCheckoutLoadingProposalId(proposal.id)

    try {
      const response = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: proposal.id,
        }),
      })

      const json = await response.json()

      if (!response.ok) {
        throw new Error(json.error ?? 'No se pudo crear la sesion de pago')
      }

      const checkoutUrl = json.data?.url as string | undefined
      const sessionId = json.data?.checkoutSessionId as string | undefined
      const expiresAtIso = json.data?.expiresAt as string | undefined

      if (!checkoutUrl || !sessionId || !expiresAtIso) {
        throw new Error('La sesion de pago no regreso un link.')
      }

      const expiresAt = new Date(expiresAtIso)
      setProposals((current) =>
        current.map((entry) =>
          entry.id === proposal.id
            ? {
                ...entry,
                activeCheckoutLink: {
                  url: checkoutUrl,
                  sessionId,
                  expiresAt,
                  isExpired: false,
                },
              }
            : entry,
        ),
      )

      try {
        await navigator.clipboard.writeText(checkoutUrl)
        toast.success('Link de pago copiado al portapapeles')
      } catch {
        toast.success('Link de pago creado')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al iniciar el pago')
    } finally {
      setCheckoutLoadingProposalId(null)
    }
  }

  return (
    <div className="space-y-6 overflow-x-hidden">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <div
            className={cn(
              'size-16 rounded-md flex items-center justify-center text-2xl font-semibold shrink-0',
              getScoreColor(lead.score)
            )}
          >
            {lead.score}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold truncate">{lead.name}</h2>
            {lead.company && (
              <p className="text-muted-foreground flex items-center gap-1 min-w-0">
                <Building2 className="size-4 shrink-0" />
                <span className="truncate">{lead.company}</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end sm:gap-1 sm:text-right">
          <p className="metric-value text-primary">${lead.value.toLocaleString()}</p>
          <Badge
            variant="outline"
            className={(statusConfig[lead.status] ?? unknownStatusInfo(lead.status)).color}
          >
            {(statusConfig[lead.status] ?? unknownStatusInfo(lead.status)).label}
          </Badge>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/15 p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <LockKeyhole className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium">Asignacion comercial</span>
            </div>
            <Badge variant="outline" className={assignmentInfo.color}>
              {assignmentInfo.label}
            </Badge>
            <p className="text-sm text-muted-foreground break-words">
              {lead.assignmentStatus === 'proposal_locked'
                ? lockedProposalTitle
                  ? `La propuesta "${lockedProposalTitle}" ya fue enviada y este lead quedo bloqueado hasta respuesta o liberacion manual.`
                  : 'Ya existe una propuesta enviada y este lead quedo bloqueado hasta respuesta o liberacion manual.'
                : lead.assignmentStatus === 'released_no_response'
                  ? 'Este lead fue liberado por falta de respuesta. Cualquier vendedor con acceso puede reclamarlo.'
                  : 'Este lead mantiene responsable comercial activo.'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {canReleaseLockedLead && (
              <Button
                type="button"
                variant="outline"
                onClick={handleReleaseLead}
                disabled={isMutatingAssignment}
              >
                {isMutatingAssignment ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Undo2 className="size-4 mr-2" />
                )}
                Liberar como sin respuesta
              </Button>
            )}
            {canClaimReleasedLead && (
              <Button
                type="button"
                onClick={handleClaimLead}
                disabled={isMutatingAssignment}
              >
                {isMutatingAssignment ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <UserPlus className="size-4 mr-2" />
                )}
                Reclamar lead
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/20 p-4 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Calendar className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium">Proximo seguimiento</span>
            </div>
            {followUpInfo && lead.nextFollowUpAt ? (
              <>
                <Badge variant="outline" className={followUpInfo.color}>
                  {followUpInfo.label}
                </Badge>
                <p className="text-sm text-muted-foreground break-words">
                  {formatLeadFollowUpDateTime(lead.nextFollowUpAt)}
                </p>
                <p className="text-sm text-muted-foreground break-words">
                  {followUpInfo.helper}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground break-words">
                Aun no hay un seguimiento programado para este lead.
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setActiveTab('activity')}
            disabled={isReleasedLeadPendingClaim}
          >
            <Calendar className="size-4 mr-2" />
            {lead.nextFollowUpAt ? 'Reprogramar' : 'Programar'}
          </Button>
        </div>
      </div>

      {/* Contact Info */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        {lead.email && (
          <div className="flex items-center gap-2 text-sm min-w-0">
            <Mail className="size-4 shrink-0 text-muted-foreground" />
            {gmailComposeUrl ? (
              <a
                href={gmailComposeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline truncate"
              >
                {lead.email}
              </a>
            ) : (
              <span className="truncate">{lead.email}</span>
            )}
          </div>
        )}
        {lead.phone && (
          <div className="flex items-center gap-2 text-sm min-w-0">
            <Phone className="size-4 shrink-0 text-muted-foreground" />
            <a href={buildPhoneCallUrl(lead.phone)} className="text-primary hover:underline truncate">
              {lead.phone}
            </a>
          </div>
        )}
        {lead.whatsapp && (
          <div className="flex items-center gap-2 text-sm min-w-0">
            <MessageSquare className="size-4 shrink-0 text-green-600" />
            <a href={buildWhatsAppUrl(lead.whatsapp)} target="_blank" rel="noopener noreferrer" className="text-green-600 hover:underline truncate">
              {lead.whatsapp}
            </a>
          </div>
        )}
        <div className="flex items-center gap-2 text-sm min-w-0">
          <Tag className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{sourceLabels[lead.source]}</span>
        </div>
        {lead.locationText && (
          <div className="flex items-center gap-2 text-sm min-w-0">
            <MapPin className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{lead.locationText}</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-sm min-w-0">
          <Calendar className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">Creado: {lead.createdAt.toLocaleDateString('es-MX')}</span>
        </div>
        {lead.lastContactedAt && (
          <div className="flex items-center gap-2 text-sm min-w-0 sm:col-span-2">
            <Clock className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Ultimo contacto: {lead.lastContactedAt.toLocaleDateString('es-MX')}</span>
          </div>
        )}
        {lead.nextFollowUpAt && (
          <div className="flex items-center gap-2 text-sm min-w-0 sm:col-span-2">
            <Calendar className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Proximo seguimiento: {formatLeadFollowUpDateTime(lead.nextFollowUpAt)}</span>
          </div>
        )}
      </div>

      {/* Tags */}
      {lead.tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {lead.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Notes */}
      {lead.notes && (
        <div className="p-3 bg-muted/50 rounded-lg">
          <p className="text-sm font-medium mb-1">Notas</p>
          <p className="text-sm text-muted-foreground break-words whitespace-pre-wrap">{lead.notes}</p>
        </div>
      )}

      <Separator />

      {/* Actions Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full max-w-full overflow-x-auto flex-nowrap justify-start md:justify-center">
          {maxwellSnapshot && (
            <TabsTrigger value="maxwell" className="shrink-0 md:flex-1">Maxwell</TabsTrigger>
          )}
          <TabsTrigger value="activity" className="shrink-0 md:flex-1">Seguimiento</TabsTrigger>
          <TabsTrigger value="proposal" className="shrink-0 md:flex-1">Propuesta</TabsTrigger>
          <TabsTrigger value="status" className="shrink-0 md:flex-1">Estado</TabsTrigger>
          <TabsTrigger value="ai" className="shrink-0 md:flex-1">IA Asistente</TabsTrigger>
        </TabsList>

        {maxwellSnapshot && (
          <TabsContent value="maxwell" className="space-y-4 pt-4">
            <Card className="gap-4 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-base">Auditoria Maxwell</CardTitle>
              </CardHeader>
              <CardContent className="px-4 space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-md border bg-muted/20 p-3 min-w-0">
                    <p className="text-xs text-muted-foreground">Industria</p>
                    <p className="text-sm font-medium break-words">{maxwellSnapshot.business.industry}</p>
                  </div>
                  <div className="rounded-md border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Prioridad</p>
                    <p className="text-sm font-medium">
                      {maxwellSnapshot.scoring.priority === 'high' ? 'Alta prioridad' : 'Oportunidad valida'}
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Confianza</p>
                    <p className="text-sm font-medium capitalize">{maxwellSnapshot.confidence}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Dolor principal</p>
                  <p className="text-sm text-muted-foreground break-words">{maxwellSnapshot.audit.mainPain}</p>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Evidencia y posible impacto</p>
                  <div className="space-y-2">
                    {maxwellSnapshot.audit.pains.map((pain) => (
                      <div key={`${pain.title}-${pain.evidence}`} className="rounded-md border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium break-words min-w-0 flex-1">{pain.title}</p>
                          <Badge variant="outline" className="capitalize shrink-0">
                            {pain.confidence}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground break-words">{pain.evidence}</p>
                        <p className="mt-1 text-xs text-muted-foreground break-words">{pain.impact}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border p-3 min-w-0">
                    <p className="text-sm font-medium">Oportunidad Noon</p>
                    <p className="mt-1 text-sm text-muted-foreground break-words">
                      {maxwellSnapshot.opportunity.noonOpportunity}
                    </p>
                  </div>
                  <div className="rounded-md border p-3 min-w-0">
                    <p className="text-sm font-medium">Idea de prototipo</p>
                    <p className="mt-1 text-sm text-muted-foreground break-words">
                      {maxwellSnapshot.opportunity.prototypeIdea}
                    </p>
                  </div>
                </div>

                <div className="rounded-md border p-3 min-w-0">
                  <p className="text-sm font-medium">Objeciones probables</p>
                  <div className="mt-2 space-y-2">
                    {maxwellSnapshot.objections.map((item) => (
                      <div key={`${item.objection}-${item.response}`} className="min-w-0">
                        <p className="text-sm break-words">{item.objection}</p>
                        <p className="text-xs text-muted-foreground break-words">{item.response}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="gap-4 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-base">Speech sugerido</CardTitle>
              </CardHeader>
              <CardContent className="px-4 space-y-4">
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(speechVariantLabels) as SpeechVariant[]).map((variant) => (
                    <Button
                      key={variant}
                      type="button"
                      size="sm"
                      variant={speechVariant === variant ? 'default' : 'outline'}
                      onClick={() => {
                        handleStopSpeech()
                        setSpeechVariant(variant)
                      }}
                    >
                      {speechVariantLabels[variant]}
                    </Button>
                  ))}
                </div>

                <div className="rounded-md border bg-muted/20 p-3 min-w-0">
                  <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{currentSpeech}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={handlePlaySpeech}>
                    <Volume2 className="size-4 mr-2" />
                    Reproducir
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleStopSpeech}
                    disabled={!isSpeechPlaying}
                  >
                    <Square className="size-4 mr-2" />
                    Detener
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleCopyText(currentSpeech, 'Speech copiado')}
                  >
                    <Copy className="size-4 mr-2" />
                    Copiar
                  </Button>
                </div>

                <Separator />

                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs text-muted-foreground">Calificar calidad del lead:</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isSavingMaxwellFeedback}
                    onClick={() => void handleMaxwellFeedback('good')}
                  >
                    <ThumbsUp className="size-3.5 mr-1.5" />
                    Bueno
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isSavingMaxwellFeedback}
                    onClick={() => void handleMaxwellFeedback('duplicate', 'Marcado como posible duplicado desde Detalles.')}
                  >
                    <Flag className="size-3.5 mr-1.5" />
                    Duplicado
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isSavingMaxwellFeedback}
                    onClick={() => void handleMaxwellFeedback('bad', 'Lead reportado como baja calidad.')}
                  >
                    Mala calidad
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="activity" className="space-y-4 pt-4">
          <Card className="gap-4 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-base">Programar siguiente seguimiento</CardTitle>
            </CardHeader>
            <CardContent className="px-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="lead-follow-up-at">Fecha y hora</Label>
                <Input
                  id="lead-follow-up-at"
                  type="datetime-local"
                  value={followUpInput}
                  onChange={(event) => setFollowUpInput(event.target.value)}
                  disabled={isReleasedLeadPendingClaim || isSavingFollowUp}
                />
                <p className="text-xs text-muted-foreground">
                  Define el siguiente toque comercial real para que el lead no quede sin seguimiento.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={handleSaveFollowUp}
                  disabled={!followUpInput || isReleasedLeadPendingClaim || isSavingFollowUp}
                >
                  {isSavingFollowUp ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Calendar className="size-4 mr-2" />
                  )}
                  Guardar seguimiento
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClearFollowUp}
                  disabled={!lead.nextFollowUpAt || isReleasedLeadPendingClaim || isSavingFollowUp}
                >
                  Limpiar seguimiento
                </Button>
              </div>
            </CardContent>
          </Card>

          {isSupabaseMode && (
            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Seguimiento automático</p>
                <p className="text-xs text-muted-foreground">
                  Maxwell genera un mensaje cuando vence el seguimiento
                </p>
              </div>
              <Switch
                checked={lead.autoFollowupEnabled}
                onCheckedChange={async (checked) => {
                  try {
                    await updateLead(lead.id, { autoFollowupEnabled: checked })
                  } catch {
                    // ignore
                  }
                }}
                disabled={isReleasedLeadPendingClaim}
              />
            </div>
          )}

          <div className="space-y-3">
            <label className="text-sm font-medium">Registrar nota de seguimiento</label>
            <Textarea
              placeholder="Escribe una nota sobre este lead..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              disabled={isReleasedLeadPendingClaim}
              rows={4}
            />
            <Button
              onClick={handleSaveNote}
              disabled={!noteText.trim() || isSavingNote || isReleasedLeadPendingClaim}
            >
              {isSavingNote ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4 mr-2" />
              )}
              Guardar nota
            </Button>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <History className="size-4 text-muted-foreground" />
              <p className="text-sm font-medium">Historial de actividad</p>
            </div>

            {isActivityLoading ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Cargando historial...
              </div>
            ) : activities.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Aun no hay actividad registrada para este lead.
              </div>
            ) : (
              <div className="divide-y">
                {activities.map((activity) => (
                  <div key={activity.id} className="py-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium break-words">{formatActivityTitle(activity)}</p>
                        <p className="text-xs text-muted-foreground break-words">
                          {activity.actorName} · {activity.createdAt.toLocaleString('es-MX')}
                        </p>
                      </div>
                      <Badge variant="secondary" className="capitalize shrink-0">
                        {activity.type === 'note_added' ? 'Nota' : activity.type.replaceAll('_', ' ')}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
                      {formatActivityBody(activity)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="proposal" className="space-y-4 pt-4">
          <LeadPrototypeCard
            leadId={lead.id}
            authMode={authMode}
            isDisabled={isReleasedLeadPendingClaim}
            refreshKey={prototypeRefreshKey}
          />

          <Card className="gap-4 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-base">Hand-off a delivery</CardTitle>
            </CardHeader>
            <CardContent className="px-4 space-y-3">
              {proposalsWithLinkedProject.length > 0 ? (
                proposalsWithLinkedProject.map((proposal) => (
                  <div
                    key={proposal.id}
                    className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium break-words">
                          Proyecto derivado: {proposal.linkedProject?.name}
                        </p>
                        <p className="text-xs text-muted-foreground break-words">
                          Originado desde la propuesta &quot;{proposal.title}&quot;.
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {proposal.linkedProject
                          ? projectStatusLabels[proposal.linkedProject.status]
                          : 'Proyecto'}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>
                        Creado el {proposal.linkedProject?.createdAt.toLocaleString('es-MX')}
                      </span>
                      {!canOpenProjectsRoute ? (
                        <span>Visible en delivery para roles con acceso.</span>
                      ) : null}
                    </div>
                    {proposal.linkedProject && canOpenProjectsRoute ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={buildProjectDetailHref(proposal.linkedProject.id)}>Ir a proyectos</Link>
                      </Button>
                    ) : null}
                  </div>
                ))
              ) : handoffReadyPendingProposals.length > 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground space-y-2">
                  <p className="font-medium text-foreground">Hand-off listo, pendiente de conversion</p>
                  {handoffReadyPendingProposals.map((proposal) => (
                    <p key={proposal.id}>
                      &quot;{proposal.title}&quot;{proposal.handoffReadyAt
                        ? ` lista desde ${proposal.handoffReadyAt.toLocaleString('es-MX')}`
                        : ' lista para crear proyecto'}
                    </p>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Aun no existe proyecto derivado de esta oportunidad.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="gap-4 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-base">Registrar propuesta comercial</CardTitle>
            </CardHeader>
            <CardContent className="px-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="proposal-title">Titulo</Label>
                <Input
                  id="proposal-title"
                  value={proposalForm.title}
                  onChange={(event) =>
                    setProposalForm((prev) => ({ ...prev, title: event.target.value }))
                  }
                  disabled={isReleasedLeadPendingClaim}
                  placeholder="Propuesta - Cliente"
                />
              </div>

              {lead.leadOrigin === 'outbound' ? (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="proposal-project-type">Tipo de proyecto</Label>
                      <Select
                        value={proposalForm.projectType}
                        onValueChange={(value) =>
                          setProposalForm((prev) => ({ ...prev, projectType: value as ProjectType }))
                        }
                        disabled={isReleasedLeadPendingClaim}
                      >
                        <SelectTrigger id="proposal-project-type">
                          <SelectValue placeholder="Seleccionar tipo" />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(PROJECT_TYPE_LABELS) as ProjectType[]).map((type) => (
                            <SelectItem key={type} value={type}>
                              {PROJECT_TYPE_LABELS[type]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="proposal-complexity">Complejidad</Label>
                      <Select
                        value={proposalForm.complexity}
                        onValueChange={(value) =>
                          setProposalForm((prev) => ({ ...prev, complexity: value as Complexity }))
                        }
                        disabled={isReleasedLeadPendingClaim}
                      >
                        <SelectTrigger id="proposal-complexity">
                          <SelectValue placeholder="Seleccionar complejidad" />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(COMPLEXITY_LABELS) as Complexity[]).map((level) => (
                            <SelectItem key={level} value={level}>
                              {COMPLEXITY_LABELS[level]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="proposal-seller-fee">Tu comision (seller fee)</Label>
                    <Select
                      value={proposalForm.sellerFeeAmount}
                      onValueChange={(value) =>
                        setProposalForm((prev) => ({ ...prev, sellerFeeAmount: value }))
                      }
                      disabled={isReleasedLeadPendingClaim}
                    >
                      <SelectTrigger id="proposal-seller-fee">
                        <SelectValue placeholder="Seleccionar fee" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="100">$100 USD</SelectItem>
                        <SelectItem value="300">$300 USD</SelectItem>
                        <SelectItem value="500">$500 USD</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Se agrega al monto que paga el cliente y se acredita a tu wallet al confirmar el pago. El cliente no ve el desglose.
                    </p>
                  </div>

                  {proposalForm.projectType && proposalForm.complexity ? (() => {
                    const sellerFeeNum = Number.parseInt(proposalForm.sellerFeeAmount, 10)
                    const sellerFeeForPricing = (sellerFeeNum === 100 || sellerFeeNum === 300 || sellerFeeNum === 500
                      ? sellerFeeNum
                      : 100) as SellerFeeAmount
                    const pricing = computePricing(
                      proposalForm.projectType as ProjectType,
                      proposalForm.complexity as Complexity,
                      'outbound',
                      sellerFeeForPricing,
                    )
                    return (
                      <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Base de activacion</span>
                          <span className="font-medium tabular-nums">${pricing.activationBase} USD</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Tu comision</span>
                          <span className="font-medium tabular-nums">${pricing.sellerFee} USD</span>
                        </div>
                        <Separator />
                        <div className="flex items-center justify-between text-foreground font-semibold">
                          <span>Total al cliente</span>
                          <span className="tabular-nums">${pricing.activationFinal} USD</span>
                        </div>
                        <p className="text-xs text-muted-foreground pt-1">
                          El monto se calcula automaticamente desde la tabla oficial. No editable.
                        </p>
                      </div>
                    )
                  })() : (
                    <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                      Selecciona tipo de proyecto y complejidad para calcular el monto final.
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="proposal-amount">Monto estimado</Label>
                  <Input
                    id="proposal-amount"
                    type="number"
                    min="0"
                    value={proposalForm.amount}
                    onChange={(event) =>
                      setProposalForm((prev) => ({ ...prev, amount: event.target.value }))
                    }
                    disabled={isReleasedLeadPendingClaim}
                    placeholder="0"
                  />
                  <p className="text-xs text-muted-foreground">
                    Para leads inbound el monto lo define el flujo del website. Este campo queda como referencia interna.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="proposal-body">Contenido</Label>
                  {generatedContent && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setProposalForm((prev) => ({
                          ...prev,
                          body: generatedContent,
                          title: prev.title || buildDefaultProposalTitle(lead),
                          amount: prev.amount || lead.value.toString(),
                        }))
                      }
                    >
                      Usar contenido IA
                    </Button>
                  )}
                </div>
                <Textarea
                  id="proposal-body"
                  value={proposalForm.body}
                  onChange={(event) =>
                    setProposalForm((prev) => ({ ...prev, body: event.target.value }))
                  }
                  disabled={isReleasedLeadPendingClaim}
                  placeholder="Describe alcance, inversion y siguientes pasos..."
                  rows={8}
                />
              </div>

              <Button
                onClick={handleSaveProposal}
                disabled={
                  !proposalForm.title.trim() ||
                  !proposalForm.body.trim() ||
                  isSavingProposal ||
                  isReleasedLeadPendingClaim ||
                  (lead.leadOrigin === 'outbound' &&
                    (!proposalForm.projectType || !proposalForm.complexity))
                }
              >
                {isSavingProposal ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <FileText className="size-4 mr-2" />
                )}
                Guardar propuesta
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="size-4 text-muted-foreground" />
                <p className="text-sm font-medium">Propuestas</p>
              </div>
            </div>

            {isProposalsLoading ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Cargando propuestas...
              </div>
            ) : proposals.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Todavia no creaste una propuesta para este lead. Usa el formulario de arriba para guardar la primera.
              </div>
            ) : (
              <div className="space-y-3">
                {proposals.map((proposal) => {
                  const vigencia = getVigenciaLabel(proposal.expiresAt, proposal.firstOpenedAt)
                  const isReviewable = isSupabaseMode &&
                    (user?.role === 'admin' || user?.role === 'pm') &&
                    (proposal.reviewStatus === 'pending_review' || proposal.reviewStatus === 'approved') &&
                    !proposal.linkedProject
                  const effectiveState = deriveEffectiveProposalState(proposal, lead.leadOrigin)
                  // Manual status control: in supabase mode the operator may
                  // only drive the origin-appropriate transitions (inbound: none
                  // — the web owns it; outbound: draft/sent/rejected). Mock mode
                  // keeps the full set so demos can walk every state by hand.
                  const statusSelectOptions = isSupabaseMode
                    ? manualProposalStatusOptions(lead.leadOrigin)
                    : (Object.keys(proposalStatusConfig) as ProposalStatus[])
                  // Only render the select when the current value is one of the
                  // options, so a payment-driven status (accepted/handoff_ready)
                  // never leaves a Radix select rendering an empty value.
                  const showStatusSelect =
                    !proposal.linkedProject && statusSelectOptions.includes(proposal.status)
                  const showInboundStatusHint =
                    isSupabaseMode && lead.leadOrigin === 'inbound' && !proposal.linkedProject
                  return (
                  <div key={proposal.id} className="rounded-lg border bg-muted/20 p-4 space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                      <div className="min-w-0 sm:flex-1">
                        <p className="font-medium break-words">{proposal.title}</p>
                        <p className="text-xs text-muted-foreground break-words">
                          {proposal.currency} ${proposal.amount.toLocaleString()} · v{proposal.versionNumber} · {proposal.createdAt.toLocaleDateString('es-MX')}
                        </p>
                      </div>
                      {/* Single "effective state" chip — collapses the
                          status / reviewStatus / paymentStatus axes into the
                          most advanced fact. A secondary chip appears only for
                          a payment anomaly the primary does not already imply. */}
                      <div className="flex flex-wrap gap-1 sm:justify-end shrink-0">
                        <Badge variant="outline" className={effectiveState.primary.color}>
                          {effectiveState.primary.label}
                        </Badge>
                        {effectiveState.secondary && (
                          <Badge variant="outline" className={effectiveState.secondary.color}>
                            {effectiveState.secondary.label}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {effectiveState.hint && (
                      <p className="text-xs text-muted-foreground">{effectiveState.hint}</p>
                    )}

                    {/* Vigencia countdown */}
                    {vigencia && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Timer className="size-3.5" />
                        {vigencia}
                        {proposal.expiresAt && (
                          <span className="text-muted-foreground/60">
                            · Vence {proposal.expiresAt.toLocaleDateString('es-MX')}
                          </span>
                        )}
                      </div>
                    )}

                    <p className="text-sm whitespace-pre-wrap break-words text-muted-foreground max-h-40 overflow-y-auto">
                      {proposal.body}
                    </p>

                    {proposal.linkedProject && (
                      <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary min-w-0">
                        <FolderKanban className="size-4 shrink-0" />
                        <span className="break-words min-w-0">Proyecto creado: {proposal.linkedProject.name}</span>
                      </div>
                    )}

                    {/* Revisión admin/pm */}
                    {isReviewable && (
                      <div className="flex items-center gap-2 flex-wrap">
                        {proposal.reviewStatus === 'pending_review' && (
                          <Button
                            type="button"
                            size="sm"
                            variant="default"
                            onClick={() => handleReviewProposal(proposal.id, 'approve')}
                          >
                            <ShieldCheck className="size-3.5 mr-1.5" />
                            Aprobar
                          </Button>
                        )}
                        {proposal.reviewStatus !== 'cancelled' && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleReviewProposal(proposal.id, 'reject')}
                          >
                            <ShieldX className="size-3.5 mr-1.5" />
                            Rechazar
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground"
                          onClick={() => handleReviewProposal(proposal.id, 'cancel')}
                        >
                          Cancelar propuesta
                        </Button>
                      </div>
                    )}

                    <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                      <div className="text-xs text-muted-foreground">
                        {proposal.linkedProject
                          ? 'Hand-off convertido y persistido en proyectos.'
                          : proposal.handoffReadyAt
                          ? `Hand-off listo desde ${proposal.handoffReadyAt.toLocaleString('es-MX')}`
                          : proposal.acceptedAt
                            ? `Aceptada el ${proposal.acceptedAt.toLocaleString('es-MX')}`
                            : proposal.sentAt
                              ? `Enviada el ${proposal.sentAt.toLocaleString('es-MX')}`
                              : 'Aun en preparacion comercial'}
                      </div>
                      {showStatusSelect ? (
                        <Select
                          value={proposal.status}
                          disabled={isReleasedLeadPendingClaim}
                          onValueChange={(value) =>
                            handleProposalStatusChange(proposal.id, value as ProposalStatus)
                          }
                        >
                          <SelectTrigger className="w-full md:w-[220px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {statusSelectOptions.map((status) => (
                              <SelectItem key={status} value={status}>
                                {proposalStatusConfig[status].label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : showInboundStatusHint ? (
                        <p className="text-xs text-muted-foreground md:w-[220px] md:text-right">
                          El cliente gestiona la aceptación y el pago desde la web.
                        </p>
                      ) : null}
                    </div>

                    {proposal.status === 'handoff_ready' && proposal.paymentStatus === 'succeeded' && (
                      <Button
                        type="button"
                        variant={proposal.linkedProject ? 'secondary' : 'default'}
                        onClick={() => handleCreateProject(proposal.id)}
                        disabled={
                          isReleasedLeadPendingClaim ||
                          creatingProjectProposalId === proposal.id ||
                          Boolean(proposal.linkedProject)
                        }
                      >
                        {creatingProjectProposalId === proposal.id ? (
                          <Loader2 className="size-4 mr-2 animate-spin" />
                        ) : (
                          <FolderKanban className="size-4 mr-2" />
                        )}
                        {proposal.linkedProject ? 'Proyecto creado' : 'Crear proyecto'}
                      </Button>
                    )}

                    {proposal.status === 'handoff_ready' && proposal.paymentStatus !== 'succeeded' && (
                      <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                        El proyecto se activa automaticamente cuando Stripe confirma el pago.
                      </div>
                    )}

                    {isSupabaseMode && proposal.paymentStatus === 'succeeded' && (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30">
                        <CheckCircle2 className="size-3.5 mr-1.5" />
                        Pago confirmado
                      </Badge>
                    )}

                    {isSupabaseMode &&
                      proposal.reviewStatus === 'approved' &&
                      ['sent', 'accepted', 'handoff_ready'].includes(proposal.status) &&
                      proposal.paymentStatus !== 'succeeded' &&
                      proposal.activeCheckoutLink &&
                      !proposal.activeCheckoutLink.isExpired && (
                      <>
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          onClick={() => {
                            const url = proposal.activeCheckoutLink?.url
                            if (!url) return
                            navigator.clipboard
                              .writeText(url)
                              .then(() => toast.success('Link de pago copiado al portapapeles'))
                              .catch(() => toast.error('No se pudo copiar el link'))
                          }}
                          disabled={isReleasedLeadPendingClaim}
                        >
                          <Copy className="size-4 mr-2" />
                          Copiar link
                        </Button>
                        <Button asChild type="button" variant="ghost" size="sm">
                          <a
                            href={proposal.activeCheckoutLink.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink className="size-3.5 mr-1.5" />
                            Abrir link
                          </a>
                        </Button>
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          onClick={() => handleRequestPayment(proposal)}
                          disabled={
                            isReleasedLeadPendingClaim ||
                            checkoutLoadingProposalId === proposal.id
                          }
                        >
                          {checkoutLoadingProposalId === proposal.id ? (
                            <Loader2 className="size-4 mr-2 animate-spin" />
                          ) : null}
                          Crear link nuevo
                        </Button>
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Timer className="size-3.5" />
                          {formatCheckoutLinkExpiry(proposal.activeCheckoutLink.expiresAt)}
                        </span>
                      </>
                    )}

                    {isSupabaseMode &&
                      proposal.reviewStatus === 'approved' &&
                      ['sent', 'accepted', 'handoff_ready'].includes(proposal.status) &&
                      proposal.paymentStatus !== 'succeeded' &&
                      proposal.activeCheckoutLink &&
                      proposal.activeCheckoutLink.isExpired && (
                      <>
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Timer className="size-3.5" />
                          Link expirado
                        </span>
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          onClick={() => handleRequestPayment(proposal)}
                          disabled={
                            isReleasedLeadPendingClaim ||
                            checkoutLoadingProposalId === proposal.id
                          }
                        >
                          {checkoutLoadingProposalId === proposal.id ? (
                            <Loader2 className="size-4 mr-2 animate-spin" />
                          ) : (
                            <CreditCard className="size-4 mr-2" />
                          )}
                          Crear link nuevo
                        </Button>
                      </>
                    )}

                    {isSupabaseMode &&
                      proposal.reviewStatus === 'approved' &&
                      ['sent', 'accepted', 'handoff_ready'].includes(proposal.status) &&
                      proposal.paymentStatus !== 'succeeded' &&
                      !proposal.activeCheckoutLink && (
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={() => handleRequestPayment(proposal)}
                        disabled={
                          isReleasedLeadPendingClaim ||
                          checkoutLoadingProposalId === proposal.id
                        }
                      >
                        {checkoutLoadingProposalId === proposal.id ? (
                          <Loader2 className="size-4 mr-2 animate-spin" />
                        ) : (
                          <CreditCard className="size-4 mr-2" />
                        )}
                        Crear link de pago
                      </Button>
                    )}
                  </div>
                  )
                })}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="status" className="space-y-4 pt-4">
          {isReleasedLeadPendingClaim && (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Este lead esta liberado. Reclama el lead antes de cambiar su estado o registrar seguimiento comercial.
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Cambiar estado</label>
            <Select
              value={lead.status}
              disabled={isReleasedLeadPendingClaim}
              onValueChange={(value) => onStatusChange(lead.id, value as LeadStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(statusConfig).map(([status, config]) => (
                  <SelectItem key={status} value={status}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="flex-1 bg-transparent"
              onClick={handleOpenGmail}
              disabled={!hasValidEmail || isReleasedLeadPendingClaim}
            >
              <MessageSquare className="size-4 mr-2" />
              Abrir en Gmail
            </Button>
            {isSupabaseMode && phoneCallUrl && !isReleasedLeadPendingClaim ? (
              <Button asChild variant="outline" className="flex-1 bg-transparent">
                <a href={phoneCallUrl}>
                  <Phone className="size-4 mr-2" />
                  Llamar
                </a>
              </Button>
            ) : (
              <Button
                variant="outline"
                className="flex-1 bg-transparent"
                disabled={isReleasedLeadPendingClaim || (isSupabaseMode && !phoneCallUrl)}
              >
                <Phone className="size-4 mr-2" />
                {isSupabaseMode && !phoneCallUrl ? 'Llamar no disponible' : 'Llamar'}
              </Button>
            )}
            {isSupabaseMode && whatsAppUrl && !isReleasedLeadPendingClaim ? (
              <Button asChild variant="outline" className="flex-1 bg-transparent">
                <a href={whatsAppUrl} target="_blank" rel="noopener noreferrer">
                  <MessageSquare className="size-4 mr-2" />
                  WhatsApp
                </a>
              </Button>
            ) : isSupabaseMode ? (
              <Button variant="outline" className="flex-1 bg-transparent" disabled>
                <MessageSquare className="size-4 mr-2" />
                WhatsApp no disponible
              </Button>
            ) : null}
            <Button
              variant="outline"
              className="flex-1 bg-transparent"
              onClick={() => setActiveTab('activity')}
              disabled={isReleasedLeadPendingClaim}
            >
              <Calendar className="size-4 mr-2" />
              {lead.nextFollowUpAt ? 'Reprogramar' : 'Agendar'}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="ai" className="space-y-4 pt-4">
          {isSupabaseMode ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              La generacion contextual desde esta ficha aun no esta conectada al runtime real.
              Esta tab no puede redactar contenido, enviarlo ni guardar propuestas generadas por IA en
              modo supabase.
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleGenerateEmail}
                  disabled={isGenerating}
                  className="flex-1 bg-transparent"
                >
                  <Sparkles className="size-4 mr-2" />
                  Generar Email
                </Button>
                <Button
                  variant="outline"
                  onClick={handleGenerateProposal}
                  disabled={isGenerating}
                  className="flex-1 bg-transparent"
                >
                  <FileText className="size-4 mr-2" />
                  Generar Propuesta
                </Button>
              </div>

              {isGenerating && (
                <div className="p-8 text-center">
                  <div className="animate-pulse flex flex-col items-center gap-2">
                    <Sparkles className="size-8 text-primary" />
                    <p className="text-sm text-muted-foreground">Maxwell esta generando contenido...</p>
                  </div>
                </div>
              )}

              {generatedContent && !isGenerating && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Contenido generado</p>
                    <Button size="sm" variant="ghost" onClick={copyToClipboard}>
                      <Copy className="size-4 mr-1" />
                      Copiar
                    </Button>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg max-h-64 overflow-y-auto">
                    <pre className="text-sm whitespace-pre-wrap break-words font-sans">{generatedContent}</pre>
                  </div>
                  <div className="flex gap-2">
                    <Button className="flex-1" disabled={isReleasedLeadPendingClaim}>
                      <Send className="size-4 mr-2" />
                      Enviar al cliente
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 bg-transparent"
                      onClick={handleSaveGeneratedProposal}
                      disabled={isSavingProposal || isReleasedLeadPendingClaim}
                    >
                      {isSavingProposal ? (
                        <Loader2 className="size-4 mr-2 animate-spin" />
                      ) : (
                        <FileText className="size-4 mr-2" />
                      )}
                      Guardar propuesta
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
