'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { canAccessDashboardPath, useAuth } from '@/lib/auth-context'
import {
  buildLeadDetailHref,
  buildProjectDetailHref,
  clearDashboardEntityHref,
} from '@/lib/dashboard-navigation'
import { useData } from '@/lib/data-context'
import type { DeliveryUser, Project, ProjectStatus, ProjectTaskActivity, Task } from '@/lib/types'
import { calculateProjectProgress, deriveProjectDisplayStatus } from '@/lib/projects/progress'
import { ProjectFormDialog } from '@/components/project-form-dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { formatProjectActivityBody, formatProjectActivityTitle } from '@/lib/projects/activity-copy'
import { formatTaskActivityBody, formatTaskActivityTitle } from '@/lib/tasks/activity-copy'
import { toast } from 'sonner'
import {
  Blocks,
  FolderKanban,
  Clock,
  AlertTriangle,
  Eye,
  Users,
  Calendar,
  DollarSign,
  MessageSquareText,
  Plus,
  ArrowRight,
  Loader2,
  Link2,
  Copy,
  CheckCheck,
} from 'lucide-react'

function ClientTokenButton({ projectId, leadId }: { projectId: string; leadId: string | null }) {
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const res = await fetch('/api/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, leadId }),
      })
      const json = await res.json()
      if (res.ok && json.data?.token) {
        const url = `${window.location.origin}/client/${json.data.token}`
        await navigator.clipboard.writeText(url)
        setCopied(true)
        toast.success('Enlace de cliente copiado al portapapeles')
        setTimeout(() => setCopied(false), 3000)
      } else {
        toast.error(json.error ?? 'Error al generar enlace')
      }
    } catch {
      toast.error('Error de red')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Button variant="outline" onClick={handleGenerate} disabled={generating}>
      {generating ? (
        <Loader2 className="size-4 mr-2 animate-spin" />
      ) : copied ? (
        <CheckCheck className="size-4 mr-2 text-green-600" />
      ) : (
        <Link2 className="size-4 mr-2" />
      )}
      {copied ? 'Enlace copiado' : 'Enlace de cliente'}
    </Button>
  )
}

const projectStages: { status: ProjectStatus; label: string; color: string }[] = [
  { status: 'backlog', label: 'Backlog', color: 'bg-slate-500' },
  { status: 'in_progress', label: 'En Progreso', color: 'bg-blue-500' },
  { status: 'review', label: 'Revision', color: 'bg-amber-500' },
  { status: 'delivered', label: 'Entregado', color: 'bg-primary' },
  { status: 'completed', label: 'Completado', color: 'bg-emerald-500' },
]

const statusConfig: Record<ProjectStatus, { label: string; color: string }> = {
  backlog: { label: 'Backlog', color: 'bg-slate-500/10 text-slate-700' },
  in_progress: { label: 'En Progreso', color: 'bg-blue-500/10 text-blue-700' },
  review: { label: 'Revision', color: 'bg-amber-500/10 text-amber-700' },
  delivered: { label: 'Entregado', color: 'bg-primary/10 text-primary' },
  completed: { label: 'Completado', color: 'bg-emerald-500/10 text-emerald-700' },
}

function getProjectPmName(project: Project, deliveryUsers: DeliveryUser[]) {
  if (project.pmName) {
    return project.pmName
  }

  if (!project.pmId) {
    return undefined
  }

  return deliveryUsers.find((user) => user.id === project.pmId)?.name
}

function formatCompactId(value: string | undefined): string {
  if (!value) {
    return '-'
  }

  if (value.length <= 12) {
    return value
  }

  return `${value.slice(0, 8)}...${value.slice(-4)}`
}

function formatProjectSummaryDate(value?: Date): string {
  return value ? value.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' }) : 'Sin fecha visible'
}

function formatTeamSummaryLabel(teamMembers: DeliveryUser[]): string {
  if (teamMembers.length === 0) {
    return 'Sin equipo asignado'
  }

  if (teamMembers.length <= 3) {
    return teamMembers.map((member) => member.name).join(', ')
  }

  return `${teamMembers.slice(0, 3).map((member) => member.name).join(', ')} +${teamMembers.length - 3}`
}

function formatPrototypeWorkspaceStatus(status: Project['prototypeWorkspaceStatus']): string {
  if (status === 'pending_generation') {
    return 'Pendiente de generacion'
  }

  if (status === 'ready') {
    return 'Listo'
  }

  if (status === 'delivery_active') {
    return 'Activo en delivery'
  }

  return 'Archivado'
}

function formatPrototypeWorkspaceStage(stage: Project['prototypeWorkspaceStage']): string {
  return stage === 'sales' ? 'Etapa comercial' : 'Etapa delivery'
}

export default function ProjectsPage() {
  const { user, authMode } = useAuth()
  const {
    projectBoardProjects,
    deliveryUsers,
    getTasksByProject,
    getProjectActivity,
    updateProjectStatus,
    refreshProjects,
  } = useData()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban')
  const requestedProjectId = searchParams.get('projectId')

  if (!user) return null

  const canManageProjects = ['admin', 'pm'].includes(user.role)
  const canViewProjectTasks = canAccessDashboardPath(user.role, '/dashboard/tasks')
  const canViewProjectActivity = canManageProjects || user.role === 'sales_manager'
  const canOpenLeadRoute = canAccessDashboardPath(user.role, '/dashboard/leads')
  const visibleProjects = projectBoardProjects
  const replaceProjectHref = (projectId: string | null) => {
    const nextHref = projectId
      ? buildProjectDetailHref(projectId, searchParams)
      : clearDashboardEntityHref(pathname, searchParams, 'projectId')

    router.replace(nextHref, { scroll: false })
  }

  const getVisibleProjectTasks = (projectId: string) => (
    canViewProjectTasks ? getTasksByProject(projectId) : []
  )

  const getProjectDisplayStatus = (project: Project) => {
    const tasks = getVisibleProjectTasks(project.id)
    return canViewProjectTasks
      ? deriveProjectDisplayStatus(project.status, tasks)
      : project.status
  }

  const getProjectsByStatus = (status: ProjectStatus) => {
    return visibleProjects.filter((project) => getProjectDisplayStatus(project) === status)
  }

  const getProjectProgress = (projectId: string) => {
    if (!canViewProjectTasks) {
      return null
    }

    return calculateProjectProgress(getVisibleProjectTasks(projectId))
  }

  const handleStatusChange = async (projectId: string, newStatus: ProjectStatus) => {
    try {
      await updateProjectStatus(projectId, newStatus)
      toast.success(`Proyecto actualizado a "${statusConfig[newStatus].label}"`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el proyecto')
    }
  }

  const selectedProject = useMemo(
    () => visibleProjects.find((project) => project.id === selectedProjectId) ?? null,
    [visibleProjects, selectedProjectId]
  )

  useEffect(() => {
    if (!requestedProjectId) {
      return
    }

    if (selectedProjectId === requestedProjectId) {
      return
    }

    const requestedProject = visibleProjects.find((project) => project.id === requestedProjectId) ?? null

    if (!requestedProject) {
      if (visibleProjects.length > 0) {
        replaceProjectHref(null)
      }
      return
    }

    setSelectedProjectId(requestedProject.id)
  }, [requestedProjectId, selectedProjectId, visibleProjects])

  useEffect(() => {
    if (!selectedProjectId) {
      return
    }

    const hasSelectedProject = visibleProjects.some((project) => project.id === selectedProjectId)

    if (!hasSelectedProject) {
      setSelectedProjectId(null)

      if (requestedProjectId === selectedProjectId) {
        replaceProjectHref(null)
      }
    }
  }, [requestedProjectId, selectedProjectId, visibleProjects])

  // Stats
  const totalProjects = visibleProjects.length
  const activeProjects = visibleProjects.filter((project) => getProjectDisplayStatus(project) === 'in_progress').length
  const inReview = visibleProjects.filter((project) => getProjectDisplayStatus(project) === 'review').length
  const totalBudget = visibleProjects.reduce((sum, p) => sum + p.budget, 0)
  const pageDescription = canManageProjects
    ? 'Gestiona todos los proyectos del equipo'
    : user.role === 'sales_manager'
      ? 'Consulta el estado y el hand-off de los proyectos visibles sin acciones de edicion.'
      : 'Proyectos donde colaboras'

  const handleOpenProject = (projectId: string) => {
    setSelectedProjectId(projectId)

    if (requestedProjectId !== projectId) {
      replaceProjectHref(projectId)
    }
  }

  const handleProjectDialogChange = (open: boolean) => {
    if (open) {
      return
    }

    setSelectedProjectId(null)

    if (requestedProjectId) {
      replaceProjectHref(null)
    }
  }

  return (
    <div className="p-6 space-y-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-balance">Proyectos</h1>
            {!canManageProjects ? (
              <Badge variant="outline" className="gap-1">
                <Eye className="size-3.5" />
                Solo lectura
              </Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground max-w-2xl">
            {pageDescription}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as typeof viewMode)}>
            <TabsList>
              <TabsTrigger value="kanban">Kanban</TabsTrigger>
              <TabsTrigger value="list">Lista</TabsTrigger>
            </TabsList>
          </Tabs>
          {canManageProjects && authMode === 'mock' && (
            <Button variant="outline" disabled>
              <Plus className="size-4 mr-2" />
              Nuevo Proyecto desde Hand-off
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Proyectos</CardTitle>
            <FolderKanban className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalProjects}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">En Progreso</CardTitle>
            <Clock className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeProjects}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">En Revision</CardTitle>
            <AlertTriangle className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inReview}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Presupuesto Total</CardTitle>
            <DollarSign className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalBudget.toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      {/* Kanban View */}
      {viewMode === 'kanban' && (
        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="flex gap-4 pb-4" style={{ minWidth: 'max-content' }}>
            {projectStages.map((stage) => {
              const stageProjects = getProjectsByStatus(stage.status)

              return (
                <div key={stage.status} className="w-[320px] shrink-0">
                  <Card className="h-full flex flex-col">
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2">
                        <div className={cn('size-3 rounded-full', stage.color)} />
                        <CardTitle className="text-sm font-medium">{stage.label}</CardTitle>
                        <Badge variant="secondary" className="text-xs">
                          {stageProjects.length}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="flex-1 pt-0">
                      <div className="space-y-3 min-h-[200px]">
                        {stageProjects.map((project) => (
                          <ProjectCard
                            key={project.id}
                            project={project}
                            deliveryUsers={deliveryUsers}
                            progress={getProjectProgress(project.id)}
                            taskCount={canViewProjectTasks ? getVisibleProjectTasks(project.id).length : null}
                            pmName={getProjectPmName(project, deliveryUsers)}
                            canViewProjectTasks={canViewProjectTasks}
                            onClick={() => handleOpenProject(project.id)}
                          />
                        ))}
                        {stageProjects.length === 0 && (
                          <Empty className="min-h-[120px] gap-3 rounded-lg border-2 p-4">
                            <EmptyHeader className="gap-1">
                              <EmptyMedia variant="icon">
                                <FolderKanban className="size-5" />
                              </EmptyMedia>
                              <EmptyTitle className="text-sm">Sin proyectos</EmptyTitle>
                              <EmptyDescription className="text-xs">
                                No hay elementos en esta etapa por ahora.
                              </EmptyDescription>
                            </EmptyHeader>
                          </Empty>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )
            })}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <div className="space-y-3">
          {visibleProjects.length === 0 ? (
            <Card className="p-12">
              <Empty className="border-0 p-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FolderKanban className="size-5" />
                  </EmptyMedia>
                  <EmptyTitle>No hay proyectos para mostrar</EmptyTitle>
                  <EmptyDescription>
                    {canManageProjects
                      ? 'Los proyectos creados apareceran aqui.'
                      : 'Apareceran aqui cuando formes parte del equipo o tengas tareas asignadas.'}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </Card>
          ) : (
            visibleProjects.map((project) => (
              <Card
                key={project.id}
                className="p-4 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => handleOpenProject(project.id)}
              >
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold truncate">{project.name}</h3>
                      <Badge
                        variant="outline"
                        className={statusConfig[getProjectDisplayStatus(project)].color}
                      >
                        {statusConfig[getProjectDisplayStatus(project)].label}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{project.clientName}</p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-medium">${project.budget.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">Presupuesto</p>
                    </div>
                    {canViewProjectTasks ? (
                      <div className="w-24">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span>Progreso</span>
                          <span>{getProjectProgress(project.id)}%</span>
                        </div>
                        <Progress value={getProjectProgress(project.id) ?? 0} className="h-2" />
                      </div>
                    ) : (
                      <div className="text-right">
                        <p className="text-xs font-medium text-muted-foreground">Solo lectura</p>
                        <p className="text-[11px] text-muted-foreground">Sin desglose de tareas</p>
                      </div>
                    )}
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Project Detail Dialog */}
      <Dialog open={!!selectedProject} onOpenChange={handleProjectDialogChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle del Proyecto</DialogTitle>
            <DialogDescription>
              Informacion completa y tareas del proyecto
            </DialogDescription>
          </DialogHeader>
          {selectedProject && (
            <ProjectDetail
              project={selectedProject}
              tasks={getVisibleProjectTasks(selectedProject.id)}
              deliveryUsers={deliveryUsers}
              getProjectActivity={getProjectActivity}
              onStatusChange={handleStatusChange}
              refreshProjects={refreshProjects}
              canManageProjects={canManageProjects}
              canViewProjectTasks={canViewProjectTasks}
              canViewProjectActivity={canViewProjectActivity}
              canOpenLeadRoute={canOpenLeadRoute}
              authMode={authMode}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface ProjectCardProps {
  project: Project
  deliveryUsers: DeliveryUser[]
  progress: number | null
  taskCount: number | null
  pmName?: string
  canViewProjectTasks: boolean
  onClick: () => void
}

function ProjectCard({
  project,
  deliveryUsers,
  progress,
  taskCount,
  pmName,
  canViewProjectTasks,
  onClick,
}: ProjectCardProps) {
  const teamMembers = project.teamIds
    .map((id) => deliveryUsers.find((user) => user.id === id))
    .filter((member): member is DeliveryUser => Boolean(member))

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="space-y-3">
          <div>
            <h4 className="font-medium text-sm line-clamp-1">{project.name}</h4>
            <p className="text-xs text-muted-foreground">{project.clientName}</p>
          </div>

          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Calendar className="size-3" />
              {project.endDate
                ? project.endDate.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })
                : 'Sin fecha'}
            </div>
            <div className="flex items-center gap-1 font-medium text-primary">
              <DollarSign className="size-3" />
              {project.budget.toLocaleString()}
            </div>
          </div>

          <div>
            {canViewProjectTasks ? (
              <>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted-foreground">{taskCount ?? 0} tareas</span>
                  <span>{progress ?? 0}%</span>
                </div>
                <Progress value={progress ?? 0} className="h-1.5" />
              </>
            ) : (
              <div className="rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground">
                Tareas visibles solo para delivery.
              </div>
            )}
          </div>

          {(teamMembers.length > 0 || pmName) && (
            <div className="flex items-center justify-between">
              <div className="flex -space-x-2">
                {teamMembers.slice(0, 3).map((member) => (
                  <Avatar key={member?.id} className="size-6 border-2 border-background">
                    <AvatarFallback className="text-xs bg-muted">
                      {member?.name.split(' ').map((n) => n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>
                ))}
                {teamMembers.length > 3 && (
                  <div className="size-6 rounded-full bg-muted flex items-center justify-center text-xs border-2 border-background">
                    +{teamMembers.length - 3}
                  </div>
                )}
              </div>
              {pmName && (
                <span className="text-xs text-muted-foreground">PM: {pmName.split(' ')[0]}</span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

interface ProjectDetailProps {
  project: Project
  tasks: Task[]
  deliveryUsers: DeliveryUser[]
  getProjectActivity: (projectId: string) => Promise<ProjectTaskActivity[]>
  onStatusChange: (projectId: string, newStatus: ProjectStatus) => Promise<void>
  refreshProjects: () => Promise<void>
  canManageProjects: boolean
  canViewProjectTasks: boolean
  canViewProjectActivity: boolean
  canOpenLeadRoute: boolean
  authMode: 'mock' | 'supabase'
}

function ProjectDetail({
  project,
  tasks,
  deliveryUsers,
  getProjectActivity,
  onStatusChange,
  refreshProjects,
  canManageProjects,
  canViewProjectTasks,
  canViewProjectActivity,
  canOpenLeadRoute,
  authMode,
}: ProjectDetailProps) {
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isPrototypeHandoffConfirmOpen, setIsPrototypeHandoffConfirmOpen] = useState(false)
  const [isHandingOffPrototype, setIsHandingOffPrototype] = useState(false)
  const completedTasks = tasks.filter((t) => t.status === 'done').length
  const progress = canViewProjectTasks ? calculateProjectProgress(tasks) : null
  const displayStatus = canViewProjectTasks
    ? deriveProjectDisplayStatus(project.status, tasks)
    : project.status
  const teamMembers = project.teamIds
    .map((id) => deliveryUsers.find((user) => user.id === id))
    .filter((member): member is DeliveryUser => Boolean(member))
  const pmName = getProjectPmName(project, deliveryUsers)
  const isCommercialReadOnly = !canManageProjects && !canViewProjectTasks
  const canViewPrototypeWorkspace = canManageProjects || canViewProjectTasks
  const canTriggerPrototypeHandoff = authMode === 'supabase'
    && canManageProjects
    && project.prototypeWorkspaceId
    && project.prototypeWorkspaceStage === 'sales'
    && project.prototypeWorkspaceStatus === 'pending_generation'

  const handleConfirmPrototypeHandoff = async () => {
    if (!project.prototypeWorkspaceId) {
      return
    }

    setIsHandingOffPrototype(true)

    try {
      const response = await fetch(`/api/prototypes/${project.prototypeWorkspaceId}/handoff`, {
        method: 'POST',
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        const message =
          payload && typeof payload.error === 'string'
            ? payload.error
            : 'No se pudo tomar el workspace en delivery.'
        throw new Error(message)
      }

      await refreshProjects()
      setIsPrototypeHandoffConfirmOpen(false)
      toast.success('Workspace marcado en etapa delivery.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'No se pudo tomar el workspace en delivery.'
      )
    } finally {
      setIsHandingOffPrototype(false)
    }
  }

  const tasksByStatus = {
    todo: tasks.filter((t) => t.status === 'todo'),
    in_progress: tasks.filter((t) => t.status === 'in_progress'),
    review: tasks.filter((t) => t.status === 'review'),
    done: tasks.filter((t) => t.status === 'done'),
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold">{project.name}</h2>
          <p className="text-muted-foreground">{project.clientName}</p>
        </div>
        <Badge variant="outline" className={statusConfig[displayStatus].color}>
          {statusConfig[displayStatus].label}
        </Badge>
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-3 bg-muted/50 rounded-lg">
          <p className="text-xs text-muted-foreground">Presupuesto</p>
          <p className="text-lg font-bold">${project.budget.toLocaleString()}</p>
        </div>
        <div className="p-3 bg-muted/50 rounded-lg">
          <p className="text-xs text-muted-foreground">Progreso</p>
          <p className="text-lg font-bold">{canViewProjectTasks ? `${progress}%` : '-'}</p>
          {!canViewProjectTasks ? (
            <p className="text-[11px] text-muted-foreground">Visible solo para delivery.</p>
          ) : null}
        </div>
        <div className="p-3 bg-muted/50 rounded-lg">
          <p className="text-xs text-muted-foreground">Tareas</p>
          <p className="text-lg font-bold">{canViewProjectTasks ? `${completedTasks}/${tasks.length}` : '-'}</p>
          {!canViewProjectTasks ? (
            <p className="text-[11px] text-muted-foreground">Desglose reservado a delivery.</p>
          ) : null}
        </div>
        <div className="p-3 bg-muted/50 rounded-lg">
          <p className="text-xs text-muted-foreground">Fecha inicio</p>
          <p className="text-lg font-bold">
            {project.startDate?.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' }) || '-'}
          </p>
        </div>
        <div className="p-3 bg-muted/50 rounded-lg">
          <p className="text-xs text-muted-foreground">Fecha fin</p>
          <p className="text-lg font-bold">
            {project.endDate?.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' }) || '-'}
          </p>
        </div>
      </div>

      {project.description && (
        <div className="rounded-lg bg-muted/40 p-4">
          <p className="text-xs text-muted-foreground mb-1">Descripcion</p>
          <p className="text-sm">{project.description}</p>
        </div>
      )}

      {(project.sourceLeadId || project.sourceProposalId) && (
        <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Origen comercial</p>
              <p className="text-xs text-muted-foreground">
                Lineage read-only del hand-off comercial que origino este proyecto.
              </p>
            </div>
            {project.sourceLeadId && canOpenLeadRoute ? (
              <Button asChild size="sm" variant="outline">
                <Link href={buildLeadDetailHref(project.sourceLeadId)}>Ir a leads</Link>
              </Button>
            ) : null}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border bg-background p-3">
              <p className="text-xs text-muted-foreground">Lead origen</p>
              <p className="text-sm font-medium">
                {project.sourceLeadName ?? (project.sourceLeadId ? 'Lead comercial vinculado' : 'Sin lead')}
              </p>
              {project.sourceLeadId ? (
                <p className="text-xs text-muted-foreground">
                  Ref. {formatCompactId(project.sourceLeadId)}
                </p>
              ) : null}
            </div>
            <div className="rounded-lg border bg-background p-3">
              <p className="text-xs text-muted-foreground">Propuesta origen</p>
              <p className="text-sm font-medium">
                {project.sourceProposalTitle ?? (project.sourceProposalId ? 'Propuesta comercial vinculada' : 'Sin propuesta')}
              </p>
              {project.sourceProposalId ? (
                <p className="text-xs text-muted-foreground">
                  Ref. {formatCompactId(project.sourceProposalId)}
                </p>
              ) : null}
            </div>
            <div className="rounded-lg border bg-background p-3">
              <p className="text-xs text-muted-foreground">Hand-off</p>
              <p className="text-sm font-medium">
                {project.handoffReadyAt
                  ? project.handoffReadyAt.toLocaleString('es-MX')
                  : 'Sin marca visible'}
              </p>
              <p className="text-xs text-muted-foreground">
                {canViewProjectTasks
                  ? `${tasks.length} tareas visibles en delivery`
                  : 'Desglose de tareas visible solo para delivery'}
              </p>
            </div>
          </div>
        </div>
      )}

      {canViewPrototypeWorkspace && project.prototypeWorkspaceId ? (
        <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
          <div>
            <p className="text-sm font-medium">Workspace de prototipo</p>
            <p className="text-xs text-muted-foreground">
              Referencia read-only del workspace comercial vinculado a este proyecto. La continuacion real todavia no esta conectada a IA o `v0`.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border bg-background p-3">
              <p className="text-xs text-muted-foreground">Estado actual</p>
              <p className="text-sm font-medium">
                {formatPrototypeWorkspaceStatus(project.prototypeWorkspaceStatus)}
              </p>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <p className="text-xs text-muted-foreground">Etapa</p>
              <p className="text-sm font-medium">
                {formatPrototypeWorkspaceStage(project.prototypeWorkspaceStage)}
              </p>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <p className="text-xs text-muted-foreground">Solicitado por</p>
              <p className="text-sm font-medium">
                {project.prototypeRequestedByName ?? 'Usuario no visible'}
              </p>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <p className="text-xs text-muted-foreground">Creado en</p>
              <p className="text-sm font-medium">
                {project.prototypeCreatedAt
                  ? project.prototypeCreatedAt.toLocaleString('es-MX')
                  : 'Sin marca visible'}
              </p>
            </div>
          </div>
          <div className="rounded-lg border bg-background p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Blocks className="size-4 text-primary" />
              Handoff del prototipo
            </div>
            <p className="text-sm text-muted-foreground">
              Este proyecto heredo un workspace solicitado desde ventas. Hoy solo existe la trazabilidad del workspace; la continuacion real del prototipo sigue pendiente de integracion.
            </p>
            {canTriggerPrototypeHandoff ? (
              <div className="pt-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setIsPrototypeHandoffConfirmOpen(true)}
                  disabled={isHandingOffPrototype}
                >
                  {isHandingOffPrototype ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Tomando en delivery...
                    </>
                  ) : (
                    'Tomar en delivery'
                  )}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {isCommercialReadOnly ? (
        <CommercialProjectSummary
          project={project}
          pmName={pmName}
          teamMembers={teamMembers}
          getProjectActivity={getProjectActivity}
        />
      ) : null}

      {/* Progress Bar */}
      {canViewProjectTasks ? (
        <div>
          <div className="flex items-center justify-between text-sm mb-2">
            <span>Progreso general</span>
            <span className="font-medium">{progress}%</span>
          </div>
          <Progress value={progress ?? 0} className="h-3" />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
          El progreso y el desglose de tareas visibles se mantienen solo para roles de delivery.
        </div>
      )}

      {/* Team */}
      <div>
        <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Users className="size-4" />
          Equipo
        </h3>
        <div className="flex flex-wrap gap-2">
          {pmName && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 rounded-full">
              <Avatar className="size-6">
                <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                  {pmName.split(' ').map((n) => n[0]).join('')}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm">{pmName}</span>
              <Badge variant="secondary" className="text-xs">PM</Badge>
            </div>
          )}
          {teamMembers.map((member) => (
            <div key={member?.id} className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-full">
              <Avatar className="size-6">
                <AvatarFallback className="text-xs">
                  {member?.name.split(' ').map((n) => n[0]).join('')}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm">{member?.name}</span>
            </div>
          ))}
          {!pmName && teamMembers.length === 0 && (
            <div className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
              Sin PM ni equipo asignado.
            </div>
          )}
        </div>
      </div>

      {canViewProjectTasks ? (
        <div>
          <h3 className="text-sm font-medium mb-3">Tareas</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { key: 'todo', label: 'Por hacer', color: 'border-slate-300' },
              { key: 'in_progress', label: 'En progreso', color: 'border-blue-400' },
              { key: 'review', label: 'Revision', color: 'border-yellow-400' },
              { key: 'done', label: 'Completadas', color: 'border-green-400' },
            ].map(({ key, label, color }) => (
              <div key={key} className={cn('p-3 rounded-lg border-l-4', color, 'bg-muted/30')}>
                <p className="text-xs text-muted-foreground mb-1">{label}</p>
                <p className="text-xl font-bold">{tasksByStatus[key as keyof typeof tasksByStatus].length}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {canViewProjectActivity && (
        <ProjectActivityTimeline
          projectId={project.id}
          getProjectActivity={getProjectActivity}
        />
      )}

      {/* Actions */}
      {canManageProjects && (
        <div className="flex flex-wrap gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => setIsEditOpen(true)}>
            Editar Proyecto
          </Button>
          {authMode === 'supabase' && (
            <ClientTokenButton projectId={project.id} leadId={project.sourceLeadId ?? null} />
          )}
          {project.status !== 'completed' && (
            <>
              {displayStatus === 'backlog' && (
                <Button onClick={() => onStatusChange(project.id, 'in_progress')}>
                  Iniciar Proyecto
                </Button>
              )}
              {displayStatus === 'in_progress' && (
                <Button onClick={() => onStatusChange(project.id, 'review')}>
                  Enviar a Revision
                </Button>
              )}
              {displayStatus === 'review' && (
                <Button onClick={() => onStatusChange(project.id, 'delivered')}>
                  Marcar Entregado
                </Button>
              )}
              {displayStatus === 'delivered' && (
                <Button onClick={() => onStatusChange(project.id, 'completed')}>
                  Completar Proyecto
                </Button>
              )}
            </>
          )}
          {authMode === 'mock' && <Button variant="outline">Ver Tareas Detalle</Button>}
        </div>
      )}

      <ProjectFormDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        editProject={project}
      />

      <AlertDialog open={isPrototypeHandoffConfirmOpen} onOpenChange={setIsPrototypeHandoffConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tomar workspace en delivery</AlertDialogTitle>
            <AlertDialogDescription>
              Esta accion marca que el workspace ya paso a manos de delivery. La continuacion real del prototipo sigue pendiente de integracion con IA o `v0`.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isHandingOffPrototype}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={isHandingOffPrototype} onClick={handleConfirmPrototypeHandoff}>
              {isHandingOffPrototype ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Confirmando handoff...
                </>
              ) : (
                'Confirmar handoff'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface ProjectActivityTimelineProps {
  projectId: string
  getProjectActivity: (projectId: string) => Promise<ProjectTaskActivity[]>
}

function ProjectActivityTimeline({
  projectId,
  getProjectActivity,
}: ProjectActivityTimelineProps) {
  const [activities, setActivities] = useState<ProjectTaskActivity[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    let isActive = true

    const loadProjectActivity = async () => {
      setIsLoading(true)
      setErrorMessage(null)

      try {
        const nextActivities = await getProjectActivity(projectId)

        if (!isActive) {
          return
        }

        setActivities(nextActivities)
      } catch (error) {
        if (!isActive) {
          return
        }

        setActivities([])
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'No se pudo cargar el historial del proyecto.'
        )
      } finally {
        if (isActive) {
          setIsLoading(false)
        }
      }
    }

    void loadProjectActivity()

    return () => {
      isActive = false
    }
  }, [getProjectActivity, projectId, reloadCount])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <MessageSquareText className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Historial de actividad</h3>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="rounded-lg border bg-muted/10 p-4 space-y-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      ) : errorMessage ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex flex-col gap-3 p-4">
            <div>
              <p className="text-sm font-medium text-destructive">No se pudo cargar el historial.</p>
              <p className="text-sm text-muted-foreground">{errorMessage}</p>
            </div>
            <div>
              <Button variant="outline" size="sm" onClick={() => setReloadCount((count) => count + 1)}>
                Reintentar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : activities.length === 0 ? (
        <Card className="p-6">
          <Empty className="border-0 p-0">
            <EmptyHeader className="gap-2">
              <EmptyMedia variant="icon">
                <MessageSquareText className="size-5" />
              </EmptyMedia>
              <EmptyTitle>Aun no hay actividad</EmptyTitle>
              <EmptyDescription>
                La actividad visible de las tareas de este proyecto aparecera aqui.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Card>
      ) : (
        <div className="space-y-3">
          {activities.map((activity) => (
            <div key={activity.id} className="rounded-lg border bg-muted/20 p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    {activity.sourceKind === 'task_activity'
                      ? activity.taskTitle ?? 'Tarea sin titulo'
                      : 'Proyecto'}
                  </p>
                  <p className="text-xs text-muted-foreground">{activity.actorName}</p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {activity.createdAt.toLocaleString('es-MX')}
                </span>
              </div>
              <p className="text-sm font-medium">
                {activity.sourceKind === 'task_activity'
                  ? formatTaskActivityTitle(activity)
                  : formatProjectActivityTitle(activity)}
              </p>
              <p className="text-sm text-muted-foreground">
                {activity.sourceKind === 'task_activity'
                  ? formatTaskActivityBody(activity)
                  : formatProjectActivityBody(activity)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface CommercialProjectSummaryProps {
  project: Project
  pmName?: string
  teamMembers: DeliveryUser[]
  getProjectActivity: (projectId: string) => Promise<ProjectTaskActivity[]>
}

function CommercialProjectSummary({
  project,
  pmName,
  teamMembers,
  getProjectActivity,
}: CommercialProjectSummaryProps) {
  const [lastProjectActivity, setLastProjectActivity] = useState<ProjectTaskActivity | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    let isActive = true

    const loadActivity = async () => {
      setIsLoading(true)
      setErrorMessage(null)

      try {
        const activities = await getProjectActivity(project.id)

        if (!isActive) {
          return
        }

        const latestProjectOnlyActivity = activities.find((activity) => activity.sourceKind === 'project_activity') ?? null
        setLastProjectActivity(latestProjectOnlyActivity)
      } catch (error) {
        if (!isActive) {
          return
        }

        setLastProjectActivity(null)
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'No se pudo cargar el ultimo movimiento visible del proyecto.'
        )
      } finally {
        if (isActive) {
          setIsLoading(false)
        }
      }
    }

    void loadActivity()

    return () => {
      isActive = false
    }
  }, [getProjectActivity, project.id, reloadCount])

  return (
    <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
      <div>
        <p className="text-sm font-medium">Resumen para seguimiento comercial</p>
        <p className="text-xs text-muted-foreground">
          Vista read-only del estado actual del proyecto sin desglose operativo de tareas.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border bg-background p-3">
          <p className="text-xs text-muted-foreground">Estado actual</p>
          <p className="text-sm font-medium">{statusConfig[project.status].label}</p>
        </div>
        <div className="rounded-lg border bg-background p-3">
          <p className="text-xs text-muted-foreground">PM asignado</p>
          <p className="text-sm font-medium">{pmName ?? 'Sin PM asignado'}</p>
        </div>
        <div className="rounded-lg border bg-background p-3">
          <p className="text-xs text-muted-foreground">Equipo asignado</p>
          <p className="text-sm font-medium">{formatTeamSummaryLabel(teamMembers)}</p>
        </div>
        <div className="rounded-lg border bg-background p-3">
          <p className="text-xs text-muted-foreground">Calendario visible</p>
          <p className="text-sm font-medium">
            {formatProjectSummaryDate(project.startDate)} - {formatProjectSummaryDate(project.endDate)}
          </p>
        </div>
        <div className="rounded-lg border bg-background p-3 md:col-span-2">
          <p className="text-xs text-muted-foreground">Ultimo movimiento visible</p>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando movimiento...</p>
          ) : errorMessage ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-destructive">No se pudo cargar el movimiento visible.</p>
              <p className="text-sm text-muted-foreground">{errorMessage}</p>
              <Button variant="outline" size="sm" onClick={() => setReloadCount((count) => count + 1)}>
                Reintentar
              </Button>
            </div>
          ) : lastProjectActivity && lastProjectActivity.sourceKind === 'project_activity' ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">{formatProjectActivityTitle(lastProjectActivity)}</p>
              <p className="text-sm text-muted-foreground">{formatProjectActivityBody(lastProjectActivity)}</p>
              <p className="text-xs text-muted-foreground">
                {lastProjectActivity.actorName} - {lastProjectActivity.createdAt.toLocaleString('es-MX')}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aun no hay movimiento visible del proyecto.</p>
          )}
        </div>
      </div>
    </div>
  )
}
