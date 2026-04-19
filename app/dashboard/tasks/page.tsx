'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth, canManageTeam } from '@/lib/auth-context'
import { buildTaskDetailHref, clearDashboardEntityHref } from '@/lib/dashboard-navigation'
import { useData } from '@/lib/data-context'
import type { Task, TaskActivity, TaskStatus, TaskPriority } from '@/lib/types'
import { TaskFormDialog } from '@/components/task-form-dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
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
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { formatTaskActivityBody, formatTaskActivityTitle } from '@/lib/tasks/activity-copy'
import { toast } from 'sonner'
import {
  ListTodo,
  Clock,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Timer,
  FolderKanban,
  Filter,
  ArrowUpCircle,
  ArrowRightCircle,
  ArrowDownCircle,
  Flame,
} from 'lucide-react'

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

const statusConfig: Record<TaskStatus, { label: string; color: string }> = {
  todo: { label: 'Por hacer', color: 'bg-slate-500/10 text-slate-600 border-slate-200' },
  in_progress: { label: 'En progreso', color: 'bg-blue-500/10 text-blue-600 border-blue-200' },
  review: { label: 'Revision', color: 'bg-yellow-500/10 text-yellow-600 border-yellow-200' },
  done: { label: 'Completada', color: 'bg-green-500/10 text-green-600 border-green-200' },
}

const priorityConfig: Record<TaskPriority, { label: string; color: string; icon: typeof Flame }> = {
  urgent: { label: 'Urgente', color: 'text-red-600', icon: Flame },
  high: { label: 'Alta', color: 'text-orange-600', icon: ArrowUpCircle },
  medium: { label: 'Media', color: 'text-yellow-600', icon: ArrowRightCircle },
  low: { label: 'Baja', color: 'text-slate-500', icon: ArrowDownCircle },
}

export default function TasksPage() {
  const { user, authMode } = useAuth()
  const {
    taskBoardTasks,
    projectBoardProjects,
    updateTask,
    updateTaskStatus,
    getTaskActivity,
    addTaskNote,
  } = useData()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const requestedTaskId = searchParams.get('taskId')
  const canCreateTasks = user ? canManageTeam(user.role) : false
  const realProjects = projectBoardProjects.filter((project) => isUuid(project.id))
  const isSupabaseTeamTaskView = authMode === 'supabase' && user?.role !== 'developer'
  const replaceTaskHref = (taskId: string | null) => {
    const nextHref = taskId
      ? buildTaskDetailHref(taskId, searchParams)
      : clearDashboardEntityHref(pathname, searchParams, 'taskId')

    router.replace(nextHref, { scroll: false })
  }

  // Filter tasks for current user (devs see only their tasks, PMs see all)
  const visibleTasks = user?.role === 'developer'
    ? taskBoardTasks.filter((task) => task.assignedTo === user.id)
    : taskBoardTasks

  const filteredTasks = visibleTasks.filter((task) => {
    const matchesStatus = statusFilter === 'all' || task.status === statusFilter
    const matchesPriority = priorityFilter === 'all' || task.priority === priorityFilter
    return matchesStatus && matchesPriority
  })

  const getProjectName = (projectId: string) => {
    return projectBoardProjects.find((project) => project.id === projectId)?.name || 'Proyecto'
  }

  const handleStatusChange = async (taskId: string, newStatus: TaskStatus) => {
    try {
      await updateTaskStatus(taskId, newStatus)
      toast.success(`Tarea actualizada a "${statusConfig[newStatus].label}"`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la tarea')
    }
  }

  const handleQuickComplete = async (taskId: string) => {
    const task = visibleTasks.find((boardTask) => boardTask.id === taskId)
    if (task) {
      const newStatus = task.status === 'done' ? 'todo' : 'done'
      await handleStatusChange(taskId, newStatus)
    }
  }

  const handleSaveProgress = async (taskId: string, hoursWorked: string, note: string) => {
    try {
      await updateTask(taskId, {
        actualHours: hoursWorked ? Number.parseInt(hoursWorked, 10) : undefined,
      })

      if (note.trim()) {
        await addTaskNote(taskId, note)
      }

      toast.success(note.trim() ? 'Progreso y nota guardados' : 'Progreso guardado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el progreso')
    }
  }

  const selectedTask = useMemo(
    () => visibleTasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, visibleTasks]
  )

  useEffect(() => {
    if (!user) {
      return
    }

    if (!requestedTaskId) {
      return
    }

    if (selectedTaskId === requestedTaskId) {
      return
    }

    const requestedTask = visibleTasks.find((task) => task.id === requestedTaskId) ?? null

    if (!requestedTask) {
      if (visibleTasks.length > 0) {
        replaceTaskHref(null)
      }
      return
    }

    setSelectedTaskId(requestedTask.id)
  }, [requestedTaskId, selectedTaskId, user, visibleTasks])

  useEffect(() => {
    if (!user) {
      return
    }

    if (!selectedTaskId) {
      return
    }

    const nextSelectedTask = visibleTasks.find((task) => task.id === selectedTaskId) ?? null

    if (!nextSelectedTask) {
      setSelectedTaskId(null)

      if (requestedTaskId === selectedTaskId) {
        replaceTaskHref(null)
      }
    }
  }, [requestedTaskId, selectedTaskId, user, visibleTasks])

  if (!user) return null

  // Stats
  const totalTasks = visibleTasks.length
  const todoTasks = visibleTasks.filter((t) => t.status === 'todo').length
  const inProgressTasks = visibleTasks.filter((t) => t.status === 'in_progress').length
  const completedTasks = visibleTasks.filter((t) => t.status === 'done').length
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
  const pageTitle = isSupabaseTeamTaskView ? 'Tareas del equipo' : 'Mis Tareas'
  const pageDescription = isSupabaseTeamTaskView
    ? 'Supervisa y da seguimiento a las tareas visibles del equipo'
    : 'Gestiona y da seguimiento a tus tareas asignadas'
  const emptyStateDescription = isSupabaseTeamTaskView
    ? 'Ajusta los filtros o espera nuevas tareas visibles para este equipo.'
    : 'Ajusta los filtros o espera nuevas asignaciones para ver trabajo aqui.'

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-balance">{pageTitle}</h1>
          <p className="text-muted-foreground max-w-2xl">
            {pageDescription}
          </p>
        </div>
        {canCreateTasks && realProjects.length > 0 && (
          <Button onClick={() => setIsCreateOpen(true)}>
            <ListTodo className="size-4 mr-2" />
            Nueva Tarea
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tareas</CardTitle>
            <ListTodo className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalTasks}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Por Hacer</CardTitle>
            <Clock className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{todoTasks}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">En Progreso</CardTitle>
            <AlertCircle className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inProgressTasks}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completadas</CardTitle>
            <CheckCircle2 className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completedTasks}</div>
            <Progress value={completionRate} className="h-1.5 mt-2" />
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <Filter className="size-4 mr-2" />
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(statusConfig).map(([value, config]) => (
              <SelectItem key={value} value={value}>
                {config.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Prioridad" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las prioridades</SelectItem>
            {Object.entries(priorityConfig).map(([value, config]) => (
              <SelectItem key={value} value={value}>
                {config.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Task List */}
      <div className="space-y-3">
        {filteredTasks.length === 0 ? (
          <Card className="p-12">
            <Empty className="border-0 p-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ListTodo className="size-5" />
                </EmptyMedia>
                <EmptyTitle>No hay tareas que mostrar</EmptyTitle>
                <EmptyDescription>
                  {emptyStateDescription}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </Card>
        ) : (
          filteredTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              projectName={getProjectName(task.projectId)}
              onQuickComplete={handleQuickComplete}
              onClick={() => {
                setSelectedTaskId(task.id)

                if (requestedTaskId !== task.id) {
                  replaceTaskHref(task.id)
                }
              }}
            />
          ))
        )}
      </div>

      {/* Task Detail Dialog */}
      <Dialog
        open={!!selectedTask}
        onOpenChange={(open) => {
          if (open) {
            return
          }

          setSelectedTaskId(null)

          if (requestedTaskId) {
            replaceTaskHref(null)
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalle de Tarea</DialogTitle>
            <DialogDescription>
              Actualiza el estado y registra tu progreso
            </DialogDescription>
          </DialogHeader>
          {selectedTask && (
            <TaskDetail
              task={selectedTask}
              projectName={getProjectName(selectedTask.projectId)}
              onStatusChange={handleStatusChange}
              onSaveProgress={handleSaveProgress}
              getTaskActivity={getTaskActivity}
            />
          )}
        </DialogContent>
      </Dialog>

      <TaskFormDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
      />
    </div>
  )
}

interface TaskCardProps {
  task: Task
  projectName: string
  onQuickComplete: (taskId: string) => void
  onClick: () => void
}

function TaskCard({ task, projectName, onQuickComplete, onClick }: TaskCardProps) {
  const PriorityIcon = priorityConfig[task.priority].icon
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done'

  return (
    <Card
      className={cn(
        'p-4 cursor-pointer hover:shadow-md transition-shadow',
        isOverdue && 'border-destructive/50'
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-4">
        {/* Checkbox */}
        <Checkbox
          checked={task.status === 'done'}
          onCheckedChange={(e) => {
            e // prevent event
            onQuickComplete(task.id)
          }}
          onClick={(e) => e.stopPropagation()}
          className="mt-1"
        />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h3 className={cn(
                'font-medium truncate',
                task.status === 'done' && 'line-through text-muted-foreground'
              )}>
                {task.title}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <FolderKanban className="size-3" />
                  {projectName}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className={statusConfig[task.status].color}>
                {statusConfig[task.status].label}
              </Badge>
            </div>
          </div>

          {/* Meta Info */}
          <div className="flex flex-wrap items-center gap-4 mt-3 text-sm">
            <span className={cn('flex items-center gap-1', priorityConfig[task.priority].color)}>
              <PriorityIcon className="size-4" />
              {priorityConfig[task.priority].label}
            </span>
            {task.dueDate && (
              <span className={cn(
                'flex items-center gap-1',
                isOverdue ? 'text-destructive' : 'text-muted-foreground'
              )}>
                <Calendar className="size-3" />
                {task.dueDate.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })}
                {isOverdue && ' (Vencida)'}
              </span>
            )}
            {task.estimatedHours && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Timer className="size-3" />
                {task.actualHours || 0}/{task.estimatedHours}h
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

interface TaskDetailProps {
  task: Task
  projectName: string
  onStatusChange: (taskId: string, newStatus: TaskStatus) => Promise<void>
  onSaveProgress: (taskId: string, hoursWorked: string, note: string) => Promise<void>
  getTaskActivity: (taskId: string) => Promise<TaskActivity[]>
}

function TaskDetail({ task, projectName, onStatusChange, onSaveProgress, getTaskActivity }: TaskDetailProps) {
  const [hoursWorked, setHoursWorked] = useState(task.actualHours?.toString() || '')
  const [notes, setNotes] = useState('')
  const [activities, setActivities] = useState<TaskActivity[]>([])
  const [isLoadingActivity, setIsLoadingActivity] = useState(false)
  const [isSavingProgress, setIsSavingProgress] = useState(false)
  const PriorityIcon = priorityConfig[task.priority].icon

  const refreshActivity = async () => {
    const nextActivities = await getTaskActivity(task.id)
    setActivities(nextActivities)
  }

  useEffect(() => {
    let isActive = true

    setIsLoadingActivity(true)
    getTaskActivity(task.id)
      .then((nextActivities) => {
        if (isActive) {
          setActivities(nextActivities)
        }
      })
      .catch(() => {
        if (isActive) {
          setActivities([])
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoadingActivity(false)
        }
      })

    return () => {
      isActive = false
    }
  }, [getTaskActivity, task.id])

  useEffect(() => {
    setHoursWorked(task.actualHours?.toString() || '')
  }, [task.actualHours, task.id])

  const handleSaveProgress = async () => {
    setIsSavingProgress(true)
    try {
      await onSaveProgress(task.id, hoursWorked, notes)
      await refreshActivity()
      setNotes('')
    } finally {
      setIsSavingProgress(false)
    }
  }

  const handleStatusSelect = async (newStatus: TaskStatus) => {
    await onStatusChange(task.id, newStatus)
    await refreshActivity()
  }

  return (
    <div className="space-y-6">
      {/* Task Info */}
      <div>
        <h3 className="font-semibold text-lg">{task.title}</h3>
        <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
          <FolderKanban className="size-4" />
          {projectName}
        </p>
      </div>

      {task.description && (
        <p className="text-sm text-muted-foreground">{task.description}</p>
      )}

      {/* Status & Priority */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <Label className="text-xs text-muted-foreground">Estado</Label>
          <Select
            value={task.status}
            onValueChange={(v) => {
              void handleStatusSelect(v as TaskStatus)
            }}
          >
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(statusConfig).map(([value, config]) => (
                <SelectItem key={value} value={value}>
                  {config.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1">
          <Label className="text-xs text-muted-foreground">Prioridad</Label>
          <div className={cn(
            'mt-1 flex items-center gap-2 p-2 rounded-md border',
            priorityConfig[task.priority].color
          )}>
            <PriorityIcon className="size-4" />
            {priorityConfig[task.priority].label}
          </div>
        </div>
      </div>

      {/* Time Info */}
      <div className="grid grid-cols-2 gap-4">
        {task.dueDate && (
          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground">Fecha limite</p>
            <p className="font-medium">{task.dueDate.toLocaleDateString('es-MX')}</p>
          </div>
        )}
        {task.estimatedHours && (
          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground">Horas estimadas</p>
            <p className="font-medium">{task.estimatedHours}h</p>
          </div>
        )}
      </div>

      {/* Log Progress */}
      <div className="space-y-3 pt-4 border-t">
        <h4 className="font-medium">Registrar progreso</h4>
        <div className="space-y-2">
          <Label htmlFor="hours">Horas trabajadas</Label>
          <Input
            id="hours"
            type="number"
            placeholder="0"
            value={hoursWorked}
            onChange={(e) => setHoursWorked(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">Notas de avance</Label>
          <Textarea
            id="notes"
            placeholder="Describe que avanzaste..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>
        <Button onClick={handleSaveProgress} className="w-full" disabled={isSavingProgress}>
          {isSavingProgress ? 'Guardando...' : 'Guardar progreso'}
        </Button>
      </div>

      <div className="space-y-3 pt-4 border-t">
        <h4 className="font-medium">Historial</h4>
        {isLoadingActivity ? (
          <p className="text-sm text-muted-foreground">Cargando actividad...</p>
        ) : activities.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aun no hay actividad visible en esta tarea.</p>
        ) : (
          <div className="space-y-3">
            {activities.map((activity) => (
              <div key={activity.id} className="rounded-lg border bg-muted/20 p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{formatTaskActivityTitle(activity)}</p>
                    <p className="text-xs text-muted-foreground">{activity.actorName}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {activity.createdAt.toLocaleString('es-MX')}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{formatTaskActivityBody(activity)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
