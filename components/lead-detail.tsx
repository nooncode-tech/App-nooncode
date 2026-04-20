'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
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
  ProposalReviewStatus,
  ProposalStatus,
} from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LeadPrototypeCard } from '@/components/lead-prototype-card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
} from 'lucide-react'

interface LeadDetailProps {
  lead: Lead
  onStatusChange: (leadId: string, newStatus: LeadStatus) => Promise<Lead> | void
}

const statusConfig: Record<LeadStatus, { label: string; color: string }> = {
  new: { label: 'Nuevo', color: 'bg-blue-500/10 text-blue-700' },
  contacted: { label: 'Contactado', color: 'bg-amber-500/10 text-amber-700' },
  qualified: { label: 'Calificado', color: 'bg-primary/10 text-primary' },
  proposal: { label: 'Propuesta', color: 'bg-orange-500/10 text-orange-700' },
  negotiation: { label: 'Negociacion', color: 'bg-accent/10 text-accent' },
  won: { label: 'Ganado', color: 'bg-emerald-500/10 text-emerald-700' },
  lost: { label: 'Perdido', color: 'bg-red-500/10 text-red-700' },
}

const sourceLabels: Record<string, string> = {
  website: 'Sitio Web',
  referral: 'Referido',
  cold_call: 'Llamada Fria',
  social: 'Redes Sociales',
  event: 'Evento',
  other: 'Otro',
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

const reviewStatusConfig: Record<ProposalReviewStatus, { label: string; color: string }> = {
  pending_review: { label: 'Pendiente revisión', color: 'bg-yellow-500/10 text-yellow-700' },
  approved:       { label: 'Aprobada',           color: 'bg-emerald-500/10 text-emerald-700' },
  rejected:       { label: 'Rechazada',          color: 'bg-red-500/10 text-red-700' },
  expired:        { label: 'Expirada',           color: 'bg-slate-500/10 text-slate-500' },
  cancelled:      { label: 'Cancelada',          color: 'bg-slate-500/10 text-slate-500' },
}

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
    const fromLabel = fromStatus ? statusConfig[fromStatus].label : 'Sin estado'
    const toLabel = toStatus ? statusConfig[toStatus].label : 'Actualizado'
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
  return `https://web.whatsapp.com/send?phone=${digits}`
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
  const [followUpInput, setFollowUpInput] = useState(toDateTimeLocalValue(lead.nextFollowUpAt))
  const [proposalForm, setProposalForm] = useState({
    title: buildDefaultProposalTitle(lead),
    amount: lead.value.toString(),
    body: '',
  })
  const isSupabaseMode = authMode === 'supabase'
  const hasValidEmail = isValidLeadEmail(lead.email)
  const gmailComposeUrl = hasValidEmail ? buildGmailComposeUrl(lead.email) : null
  const phoneCallUrl = lead.phone?.trim() ? buildPhoneCallUrl(lead.phone) : null
  const whatsAppUrl = lead.phone?.trim() ? buildWhatsAppUrl(lead.phone) : null
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
    if (!hasValidEmail) {
      return
    }

    window.open(buildGmailComposeUrl(lead.email), '_blank', 'noopener,noreferrer')
  }

  useEffect(() => {
    let isActive = true

    setIsActivityLoading(true)

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

    setIsProposalsLoading(true)

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
    setProposalForm((prev) => ({
      title: prev.title || buildDefaultProposalTitle(lead),
      amount: prev.amount || lead.value.toString(),
      body: prev.body,
    }))
  }, [lead])

  useEffect(() => {
    setFollowUpInput(toDateTimeLocalValue(lead.nextFollowUpAt))
  }, [lead.nextFollowUpAt])

  useEffect(() => {
    if (!isSupabaseMode) {
      return
    }

    setIsGenerating(false)
    setGeneratedContent('')
  }, [isSupabaseMode, lead.id])

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
    const amount = Number.parseFloat(proposalForm.amount)

    if (!title || !body) {
      return
    }

    setIsSavingProposal(true)

    try {
      const proposal = await addLeadProposal(lead.id, {
        title,
        body,
        amount: Number.isFinite(amount) ? amount : 0,
        currency: 'USD',
        status: 'draft',
      })
      setProposals((prev) => [proposal, ...prev])
      toast.success('Propuesta guardada')
      setProposalForm({
        title: buildDefaultProposalTitle(lead),
        amount: lead.value.toString(),
        body: '',
      })
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

    setIsSavingProposal(true)

    try {
      const proposal = await addLeadProposal(lead.id, {
        title: buildDefaultProposalTitle(lead),
        body: generatedContent,
        amount: lead.value,
        currency: 'USD',
        status: 'draft',
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
      const linkedProject = proposal.linkedProject ?? null
      const response = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: proposal.id,
          leadId: lead.id,
          projectId: linkedProject?.id ?? null,
          clientName: lead.company || lead.name,
          clientEmail: lead.email || null,
        }),
      })

      const json = await response.json()

      if (!response.ok) {
        throw new Error(json.error ?? 'No se pudo crear la sesion de pago')
      }

      window.location.href = json.data.url
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al iniciar el pago')
      setCheckoutLoadingProposalId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div
            className={cn(
              'size-16 rounded-xl flex items-center justify-center font-bold text-2xl',
              getScoreColor(lead.score)
            )}
          >
            {lead.score}
          </div>
          <div>
            <h2 className="text-xl font-bold">{lead.name}</h2>
            {lead.company && (
              <p className="text-muted-foreground flex items-center gap-1">
                <Building2 className="size-4" />
                {lead.company}
              </p>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-primary">${lead.value.toLocaleString()}</p>
          <Badge variant="outline" className={statusConfig[lead.status].color}>
            {statusConfig[lead.status].label}
          </Badge>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <LockKeyhole className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">Asignacion comercial</span>
            </div>
            <Badge variant="outline" className={assignmentInfo.color}>
              {assignmentInfo.label}
            </Badge>
            <p className="text-sm text-muted-foreground">
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
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">Proximo seguimiento</span>
            </div>
            {followUpInfo && lead.nextFollowUpAt ? (
              <>
                <Badge variant="outline" className={followUpInfo.color}>
                  {followUpInfo.label}
                </Badge>
                <p className="text-sm text-muted-foreground">
                  {formatLeadFollowUpDateTime(lead.nextFollowUpAt)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {followUpInfo.helper}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
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
      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center gap-2 text-sm">
          <Mail className="size-4 text-muted-foreground" />
          {gmailComposeUrl ? (
            <a
              href={gmailComposeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {lead.email}
            </a>
          ) : (
            <span>{lead.email}</span>
          )}
        </div>
        {lead.phone && (
          <div className="flex items-center gap-2 text-sm">
            <Phone className="size-4 text-muted-foreground" />
            <a href={buildPhoneCallUrl(lead.phone)} className="text-primary hover:underline">
              {lead.phone}
            </a>
          </div>
        )}
        <div className="flex items-center gap-2 text-sm">
          <Tag className="size-4 text-muted-foreground" />
          <span>{sourceLabels[lead.source]}</span>
        </div>
        {lead.locationText && (
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="size-4 text-muted-foreground" />
            <span>{lead.locationText}</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="size-4 text-muted-foreground" />
          <span>Creado: {lead.createdAt.toLocaleDateString('es-MX')}</span>
        </div>
        {lead.lastContactedAt && (
          <div className="flex items-center gap-2 text-sm col-span-2">
            <Clock className="size-4 text-muted-foreground" />
            <span>Ultimo contacto: {lead.lastContactedAt.toLocaleDateString('es-MX')}</span>
          </div>
        )}
        {lead.nextFollowUpAt && (
          <div className="flex items-center gap-2 text-sm col-span-2">
            <Calendar className="size-4 text-muted-foreground" />
            <span>Proximo seguimiento: {formatLeadFollowUpDateTime(lead.nextFollowUpAt)}</span>
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
          <p className="text-sm text-muted-foreground">{lead.notes}</p>
        </div>
      )}

      <Separator />

      {/* Actions Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="activity" className="flex-1">Seguimiento</TabsTrigger>
          <TabsTrigger value="proposal" className="flex-1">Propuesta</TabsTrigger>
          <TabsTrigger value="status" className="flex-1">Estado</TabsTrigger>
          <TabsTrigger value="ai" className="flex-1">IA Asistente</TabsTrigger>
        </TabsList>

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
              <div className="space-y-3">
                {activities.map((activity) => (
                  <div key={activity.id} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{formatActivityTitle(activity)}</p>
                        <p className="text-xs text-muted-foreground">
                          {activity.actorName} - {activity.createdAt.toLocaleString('es-MX')}
                        </p>
                      </div>
                      <Badge variant="secondary" className="capitalize">
                        {activity.type === 'note_added' ? 'Nota' : activity.type.replaceAll('_', ' ')}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
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
                      <div>
                        <p className="text-sm font-medium">
                          Proyecto derivado: {proposal.linkedProject?.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Originado desde la propuesta "{proposal.title}".
                        </p>
                      </div>
                      <Badge variant="outline">
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
                      "{proposal.title}"{proposal.handoffReadyAt
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
              <div className="grid grid-cols-2 gap-4">
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
                </div>
              </div>

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
                  isReleasedLeadPendingClaim
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
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="size-4 text-muted-foreground" />
              <p className="text-sm font-medium">Hand-off comercial</p>
            </div>

            {isProposalsLoading ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Cargando propuestas...
              </div>
            ) : proposals.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Aun no hay propuestas persistidas para este lead.
              </div>
            ) : (
              <div className="space-y-3">
                {proposals.map((proposal) => {
                  const vigencia = getVigenciaLabel(proposal.expiresAt, proposal.firstOpenedAt)
                  const isReviewable = isSupabaseMode &&
                    (user?.role === 'admin' || user?.role === 'pm') &&
                    (proposal.reviewStatus === 'pending_review' || proposal.reviewStatus === 'approved') &&
                    !proposal.linkedProject
                  const reviewCfg = reviewStatusConfig[proposal.reviewStatus ?? 'pending_review']
                  return (
                  <div key={proposal.id} className="rounded-lg border bg-muted/20 p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{proposal.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {proposal.currency} ${proposal.amount.toLocaleString()} · v{proposal.versionNumber} · {proposal.createdAt.toLocaleDateString('es-MX')}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1 justify-end">
                        {proposal.linkedProject ? (
                          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700">
                            Convertida
                          </Badge>
                        ) : (
                          <>
                            <Badge variant="outline" className={proposalStatusConfig[proposal.status].color}>
                              {proposalStatusConfig[proposal.status].label}
                            </Badge>
                            {isSupabaseMode && (
                              <Badge variant="outline" className={reviewCfg.color}>
                                {reviewCfg.label}
                              </Badge>
                            )}
                          </>
                        )}
                      </div>
                    </div>

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

                    <p className="text-sm whitespace-pre-wrap text-muted-foreground max-h-40 overflow-y-auto">
                      {proposal.body}
                    </p>

                    {proposal.linkedProject && (
                      <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                        <FolderKanban className="size-4" />
                        Proyecto creado: {proposal.linkedProject.name}
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
                      <Select
                        value={proposal.status}
                        disabled={isReleasedLeadPendingClaim || Boolean(proposal.linkedProject)}
                        onValueChange={(value) =>
                          handleProposalStatusChange(proposal.id, value as ProposalStatus)
                        }
                      >
                        <SelectTrigger className="w-full md:w-[220px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(proposalStatusConfig).map(([status, config]) => (
                            <SelectItem key={status} value={status}>
                              {config.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {proposal.status === 'handoff_ready' && (
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

                    {isSupabaseMode && ['sent', 'accepted', 'handoff_ready'].includes(proposal.status) && (
                      <Button
                        type="button"
                        variant="outline"
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
                        Cobrar propuesta
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
                    <pre className="text-sm whitespace-pre-wrap font-sans">{generatedContent}</pre>
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
