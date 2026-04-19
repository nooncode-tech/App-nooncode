import { z } from 'zod'

export const listPrototypeWorkspacesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  leadId: z.string().uuid().optional(),
})

export type ListPrototypeWorkspacesQuery = z.infer<typeof listPrototypeWorkspacesQuerySchema>

export const prototypeWorkspaceRouteParamsSchema = z.object({
  prototypeWorkspaceId: z.string().uuid(),
})

export type PrototypeWorkspaceRouteParams = z.infer<typeof prototypeWorkspaceRouteParamsSchema>
