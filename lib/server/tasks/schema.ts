import { z } from 'zod'

export const taskStatusSchema = z.enum([
  'todo',
  'in_progress',
  'review',
  'done',
])

export const taskPrioritySchema = z.enum([
  'low',
  'medium',
  'high',
  'urgent',
])

const nullableTrimmedString = z.string().trim().min(1).nullable()

export const createTaskSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  description: nullableTrimmedString.optional(),
  status: taskStatusSchema.default('todo'),
  priority: taskPrioritySchema.default('medium'),
  assignedTo: nullableTrimmedString.optional(),
  dueDate: z.string().date().nullable().optional(),
  estimatedHours: z.number().int().min(0).nullable().optional(),
  actualHours: z.number().int().min(0).nullable().optional(),
})

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: nullableTrimmedString.optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assignedTo: nullableTrimmedString.optional(),
  dueDate: z.string().date().nullable().optional(),
  estimatedHours: z.number().int().min(0).nullable().optional(),
  actualHours: z.number().int().min(0).nullable().optional(),
})

export type CreateTaskInput = z.infer<typeof createTaskSchema>
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>
