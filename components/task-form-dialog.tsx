'use client'

import React from "react"

import { useState } from 'react'
import { useData } from '@/lib/data-context'
import { useAuth } from '@/lib/auth-context'
import type { DeliveryUser, TaskDraft, TaskStatus, TaskPriority, TaskUpdates } from '@/lib/types'
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

interface TaskFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId?: string
  editTask?: {
    id: string
    title: string
    description?: string
    priority: TaskPriority
    estimatedHours?: number
    assigneeId?: string
  }
}

interface TaskFormState {
  title: string
  description: string
  priority: TaskPriority
  estimatedHours: string
  assigneeId: string
  projectId: string
}

const priorities: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Baja' },
  { value: 'medium', label: 'Media' },
  { value: 'high', label: 'Alta' },
  { value: 'urgent', label: 'Urgente' },
]

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function createEmptyFormData(projectId = ''): TaskFormState {
  return {
    title: '',
    description: '',
    priority: 'medium',
    estimatedHours: '',
    assigneeId: 'unassigned',
    projectId,
  }
}

export function TaskFormDialog({ open, onOpenChange, projectId, editTask }: TaskFormDialogProps) {
  const { authMode } = useAuth()
  const { addTask, updateTask, deliveryUsers, projects } = useData()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const devs = deliveryUsers.filter((user): user is DeliveryUser => user.role === 'developer')
  const availableProjects =
    authMode === 'supabase'
      ? projects.filter((project) => isUuid(project.id))
      : projects

  const [formData, setFormData] = useState<TaskFormState>({
    title: editTask?.title || '',
    description: editTask?.description || '',
    priority: editTask?.priority || 'medium' as TaskPriority,
    estimatedHours: editTask?.estimatedHours?.toString() || '',
    assigneeId: editTask?.assigneeId || 'unassigned',
    projectId: projectId || '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const assigneeId = formData.assigneeId === 'unassigned' ? undefined : formData.assigneeId
      const assignee = devs.find((d) => d.id === assigneeId)

      const taskData: TaskDraft = {
        title: formData.title,
        description: formData.description || undefined,
        priority: formData.priority,
        status: 'todo' as TaskStatus,
        estimatedHours: formData.estimatedHours ? Number.parseInt(formData.estimatedHours) : undefined,
        assigneeId,
        assigneeName: assignee?.name,
        projectId: formData.projectId,
      }

      if (editTask) {
        const taskUpdates: TaskUpdates = taskData
        await updateTask(editTask.id, taskUpdates)
        toast.success('Tarea actualizada correctamente')
      } else {
        await addTask(taskData)
        toast.success('Tarea creada correctamente')
      }

      onOpenChange(false)
      setFormData(createEmptyFormData(projectId || ''))
    } catch (error) {
      toast.error('Error al guardar la tarea')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{editTask ? 'Editar Tarea' : 'Nueva Tarea'}</DialogTitle>
          <DialogDescription>
            {editTask
              ? 'Actualiza la informacion de la tarea'
              : 'Crea una nueva tarea para el proyecto'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Titulo *</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="Implementar autenticacion"
              required
            />
          </div>

          {!projectId && (
            <div className="space-y-2">
              <Label htmlFor="project">Proyecto *</Label>
              <Select
                value={formData.projectId}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, projectId: value }))}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar proyecto" />
                </SelectTrigger>
                <SelectContent>
                  {availableProjects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="priority">Prioridad</Label>
              <Select
                value={formData.priority}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, priority: value as TaskPriority }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar prioridad" />
                </SelectTrigger>
                <SelectContent>
                  {priorities.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="estimatedHours">Horas estimadas</Label>
              <Input
                id="estimatedHours"
                type="number"
                value={formData.estimatedHours}
                onChange={(e) => setFormData((prev) => ({ ...prev, estimatedHours: e.target.value }))}
                placeholder="8"
                min="0"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="assignee">Asignar a</Label>
            <Select
              value={formData.assigneeId}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, assigneeId: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sin asignar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Sin asignar</SelectItem>
                {devs.map((dev) => (
                  <SelectItem key={dev.id} value={dev.id}>
                    {dev.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descripcion</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Detalles de la tarea, criterios de aceptacion..."
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Guardando...' : editTask ? 'Actualizar' : 'Crear Tarea'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
